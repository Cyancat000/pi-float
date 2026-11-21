use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{ipc::Channel, State, WebviewWindow};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct ActiveRequest(Mutex<Option<(String, Option<oneshot::Sender<()>>)>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    kind: ProviderKind,
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<Prompt>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ProviderKind {
    OpenAiCompatible,
    Anthropic,
}

#[derive(Deserialize, Serialize)]
struct Prompt {
    role: Role,
    content: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Role {
    User,
    Assistant,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Block {
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    ToolCall {
        text: String,
        tool_name: String,
        tool_call_id: String,
    },
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<u64>,
    total_tokens: u64,
    cost: f64,
}

#[derive(Serialize)]
pub struct ChatOutcome {
    blocks: Vec<Block>,
    usage: Option<Usage>,
    error: Option<String>,
    aborted: bool,
}

#[derive(Default)]
struct Reply {
    blocks: Vec<Block>,
    tools: BTreeMap<usize, (usize, String)>,
    usage: Option<Usage>,
}

impl Reply {
    fn text(&mut self, delta: &str, thinking: bool) {
        if delta.is_empty() {
            return;
        }
        match (self.blocks.last_mut(), thinking) {
            (Some(Block::Thinking { text }), true) | (Some(Block::Text { text }), false) => {
                text.push_str(delta)
            }
            (_, true) => self.blocks.push(Block::Thinking { text: delta.into() }),
            (_, false) => self.blocks.push(Block::Text { text: delta.into() }),
        }
    }

    fn tool(&mut self, index: usize, id: &str, name: &str, delta: &str) {
        let (slot, arguments) = self.tools.entry(index).or_insert_with(|| {
            self.blocks.push(Block::ToolCall {
                text: "{}".into(),
                tool_name: String::new(),
                tool_call_id: String::new(),
            });
            (self.blocks.len() - 1, String::new())
        });
        arguments.push_str(delta);
        if let Block::ToolCall {
            text,
            tool_name,
            tool_call_id,
        } = &mut self.blocks[*slot]
        {
            if !id.is_empty() {
                *tool_call_id = id.into();
            }
            tool_name.push_str(name);
            // Keep projection JSON-shaped while a provider is still sending partial arguments.
            if let Ok(value) = serde_json::from_str::<Value>(arguments) {
                *text = value.to_string();
            }
        }
    }

    fn openai(&mut self, chunk: &Value) -> Result<(), String> {
        if chunk.get("error").is_some_and(|error| !error.is_null()) {
            return Err("提供商报告流式请求失败".into());
        }
        let delta = &chunk["choices"][0]["delta"];
        if let Some(text) = delta["reasoning_content"]
            .as_str()
            .or(delta["reasoning"].as_str())
        {
            self.text(text, true);
        }
        if let Some(text) = delta["content"].as_str() {
            self.text(text, false);
        }
        if let Some(calls) = delta["tool_calls"].as_array() {
            for call in calls {
                self.tool(
                    number(&call["index"]) as usize,
                    string(&call["id"]),
                    string(&call["function"]["name"]),
                    string(&call["function"]["arguments"]),
                );
            }
        }
        let usage = &chunk["usage"];
        if usage.is_object() {
            let prompt = number(&usage["prompt_tokens"]);
            let cache_read = number(&usage["prompt_tokens_details"]["cached_tokens"]);
            let output = number(&usage["completion_tokens"]);
            self.usage = Some(Usage {
                input: prompt.saturating_sub(cache_read),
                output,
                cache_read,
                reasoning: usage["completion_tokens_details"]["reasoning_tokens"].as_u64(),
                total_tokens: usage["total_tokens"]
                    .as_u64()
                    .unwrap_or(prompt.saturating_add(output)),
                ..Usage::default()
            });
        }
        Ok(())
    }

    fn anthropic(&mut self, chunk: &Value) -> Result<bool, String> {
        let index = number(&chunk["index"]) as usize;
        match string(&chunk["type"]) {
            "error" => return Err("提供商报告流式请求失败".into()),
            "message_stop" => return Ok(true),
            "message_start" | "message_delta" => {
                let source = chunk.get("usage").unwrap_or(&chunk["message"]["usage"]);
                if source.is_object() {
                    let usage = self.usage.get_or_insert_with(Usage::default);
                    for (target, key) in [
                        (&mut usage.input, "input_tokens"),
                        (&mut usage.output, "output_tokens"),
                        (&mut usage.cache_read, "cache_read_input_tokens"),
                        (&mut usage.cache_write, "cache_creation_input_tokens"),
                    ] {
                        if let Some(value) = source[key].as_u64() {
                            *target = value;
                        }
                    }
                    usage.total_tokens = [
                        usage.input,
                        usage.output,
                        usage.cache_read,
                        usage.cache_write,
                    ]
                    .into_iter()
                    .fold(0, u64::saturating_add);
                }
            }
            "content_block_start" => {
                let block = &chunk["content_block"];
                match string(&block["type"]) {
                    "text" => self.text(string(&block["text"]), false),
                    "thinking" => self.text(string(&block["thinking"]), true),
                    "tool_use" => {
                        self.tool(index, string(&block["id"]), string(&block["name"]), "");
                        // The usual empty input object is followed by JSON deltas.
                        if block["input"]
                            .as_object()
                            .is_some_and(|input| !input.is_empty())
                        {
                            self.tool(index, "", "", &block["input"].to_string());
                        }
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let delta = &chunk["delta"];
                match string(&delta["type"]) {
                    "text_delta" => self.text(string(&delta["text"]), false),
                    "thinking_delta" => self.text(string(&delta["thinking"]), true),
                    "input_json_delta" => self.tool(index, "", "", string(&delta["partial_json"])),
                    _ => {}
                }
            }
            _ => {}
        }
        Ok(false)
    }
}

fn string(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}
fn number(value: &Value) -> u64 {
    value.as_u64().unwrap_or_default()
}

fn endpoint(base: &str, kind: ProviderKind) -> Result<Url, String> {
    let mut url = Url::parse(base).map_err(|_| "Base URL 无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Base URL 必须是无凭据、查询参数和片段的 HTTP(S) 地址".into());
    }
    let path = url.path().trim_end_matches('/');
    let suffix = match kind {
        ProviderKind::OpenAiCompatible => "/chat/completions",
        ProviderKind::Anthropic => "/messages",
    };
    if !path.ends_with(suffix) {
        let prefix = if path.is_empty() { "/v1" } else { path };
        url.set_path(&format!("{prefix}{suffix}"));
    }
    Ok(url)
}

async fn stream(
    request: ChatRequest,
    reply: &mut Reply,
    updates: Channel<Vec<Block>>,
) -> Result<(), String> {
    let url = endpoint(request.base_url.trim(), request.kind)?;
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法启动 HTTP 客户端")?;
    let mut http = client.post(url).header("accept", "text/event-stream");
    let body = match request.kind {
        ProviderKind::OpenAiCompatible => {
            if !request.api_key.is_empty() {
                http = http.bearer_auth(&request.api_key);
            }
            json!({"model": request.model, "messages": request.messages, "stream": true, "stream_options": {"include_usage": true}})
        }
        ProviderKind::Anthropic => {
            http = http
                .header("x-api-key", &request.api_key)
                .header("anthropic-version", "2023-06-01");
            json!({"model": request.model, "messages": request.messages, "stream": true, "max_tokens": 4096})
        }
    };
    let mut response = http
        .try_clone()
        .ok_or("无法构造请求")?
        .json(&body)
        .send()
        .await
        .map_err(|_| "无法连接提供商或请求超时")?;
    if matches!(request.kind, ProviderKind::OpenAiCompatible)
        && matches!(response.status().as_u16(), 400 | 422)
    {
        // Some compatible endpoints reject stream_options entirely.
        let mut fallback = body;
        fallback
            .as_object_mut()
            .expect("OpenAI request object")
            .remove("stream_options");
        response = http
            .json(&fallback)
            .send()
            .await
            .map_err(|_| "无法连接提供商或请求超时")?;
    }
    if !response.status().is_success() {
        return Err(format!("提供商返回 HTTP {}", response.status().as_u16()));
    }
    let mut events = response.bytes_stream().eventsource();
    let mut last = None::<Instant>;
    let mut finished = false;
    while let Some(event) = events.next().await {
        let event = event.map_err(|_| "提供商流已断开")?;
        if event.data.trim() == "[DONE]" {
            return Ok(());
        }
        if event.data.trim().is_empty() || event.event == "ping" {
            continue;
        }
        let chunk =
            serde_json::from_str::<Value>(&event.data).map_err(|_| "提供商返回了无效的流数据")?;
        match request.kind {
            ProviderKind::OpenAiCompatible => {
                reply.openai(&chunk)?;
                finished |= chunk["choices"][0]["finish_reason"].is_string();
            }
            ProviderKind::Anthropic if reply.anthropic(&chunk)? => return Ok(()),
            ProviderKind::Anthropic => {}
        }
        if !reply.blocks.is_empty()
            && last.is_none_or(|at| at.elapsed() >= Duration::from_millis(60))
        {
            updates
                .send(reply.blocks.clone())
                .map_err(|_| "主窗口已离开")?;
            last = Some(Instant::now());
        }
    }
    if finished {
        Ok(())
    } else {
        Err("提供商在生成完成前关闭了流".into())
    }
}

#[tauri::command]
pub async fn start_chat(
    window: WebviewWindow,
    state: State<'_, ActiveRequest>,
    id: String,
    request: ChatRequest,
    updates: Channel<Vec<Block>>,
) -> Result<ChatOutcome, String> {
    if window.label() != "main" {
        return Err("仅主窗可发送聊天请求".into());
    }
    let (stop, stopped) = oneshot::channel();
    {
        let mut active = state.0.lock().expect("active request lock");
        if active.is_some() {
            return Err("已有请求正在执行".into());
        }
        *active = Some((id, Some(stop)));
    }
    let mut reply = Reply::default();
    let (aborted, error) = tokio::select! {
        biased;
        _ = stopped => (true, None),
        result = stream(request, &mut reply, updates) => (false, result.err()),
    };
    state.0.lock().expect("active request lock").take();
    Ok(ChatOutcome {
        blocks: reply.blocks,
        usage: reply.usage,
        error,
        aborted,
    })
}

#[tauri::command]
pub fn stop_chat(
    window: WebviewWindow,
    state: State<'_, ActiveRequest>,
    id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗可中止聊天请求".into());
    }
    let mut active = state.0.lock().expect("active request lock");
    if let Some((running_id, stop)) = active.as_mut() {
        if running_id == &id {
            if let Some(stop) = stop.take() {
                let _ = stop.send(());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_base_urls() {
        assert_eq!(
            endpoint("http://localhost:8000", ProviderKind::OpenAiCompatible)
                .unwrap()
                .path(),
            "/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://example.org/custom/v1/", ProviderKind::Anthropic)
                .unwrap()
                .path(),
            "/custom/v1/messages"
        );
        assert_eq!(
            endpoint("https://example.org/v1/messages", ProviderKind::Anthropic)
                .unwrap()
                .path(),
            "/v1/messages"
        );
        assert!(endpoint("file:///test", ProviderKind::OpenAiCompatible).is_err());
        assert!(endpoint("https://user:pass@example.org", ProviderKind::Anthropic).is_err());
    }

    #[test]
    fn projects_openai_and_anthropic_chunks() {
        let mut reply = Reply::default();
        reply
            .openai(&json!({"choices":[{"delta":{"reasoning_content":"why"}}]}))
            .unwrap();
        reply.openai(&json!({"choices":[{"delta":{"content":"answer"}}], "usage":{"prompt_tokens":12,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":3}}})).unwrap();
        assert_eq!(
            reply.blocks,
            vec![
                Block::Thinking { text: "why".into() },
                Block::Text {
                    text: "answer".into()
                }
            ]
        );
        let usage = reply.usage.unwrap();
        assert_eq!(
            (usage.input, usage.cache_read, usage.total_tokens),
            (9, 3, 16)
        );
        let mut reply = Reply::default();
        for frame in [
            json!({"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":2}}}),
            json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"lookup","input":{}}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"q\":"}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"1}"}}),
            json!({"type":"message_delta","usage":{"output_tokens":3}}),
        ] {
            assert!(!reply.anthropic(&frame).unwrap());
        }
        assert_eq!(
            serde_json::to_value(&reply.blocks[0]).unwrap(),
            json!({"kind":"toolCall","text":"{\"q\":1}","toolName":"lookup","toolCallId":"call-1"})
        );
        assert_eq!(reply.usage.unwrap().total_tokens, 10);
    }
}
