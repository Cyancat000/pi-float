import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Contrast, Minus, Pin, PinOff, Settings, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { projectFolder, sessionKey, useTerminalBridge, type LaunchTarget } from "./bridge-client";
import { ChatPane } from "./chat-pane";
import { NotificationStack } from "./notification-stack";
import { Picker } from "./picker";
import { savePreference, usePreferences } from "./preferences";

const mainWindow = getCurrentWindow();

export function MainWindow({ ready, report }: { ready: boolean; report: (error: unknown) => void }) {
  const bridge = useTerminalBridge(report);
  const { attach, selected, sessions } = bridge;
  const [showOpacity, setShowOpacity] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const { alwaysOnTop, opacity } = usePreferences();

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const subscription = listen<LaunchTarget>("pi-float:launch-args", ({ payload }) => {
      receivedEvent = true;
      if (active) attach(payload);
    });
    void subscription.then(async () => {
      const args = await invoke<LaunchTarget>("launch_args");
      if (active && !receivedEvent) attach(args);
    }).catch((error) => { if (active) report(error); });
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [attach, report]);

  async function togglePin() {
    setPinPending(true);
    try {
      await mainWindow.setAlwaysOnTop(!alwaysOnTop);
      await savePreference("alwaysOnTop", !alwaysOnTop);
    } catch (error) {
      report(error);
    } finally {
      setPinPending(false);
    }
  }

  function commitOpacity() {
    void savePreference("opacity", usePreferences.getState().opacity).catch(report);
  }

  return (
    <div className="floating-shell relative flex h-full flex-col overflow-hidden" style={{ opacity }}>
      <header className="titlebar" data-tauri-drag-region>
        <Picker label="Pi 终端" value={selected} onChange={bridge.select} fallback="未附着终端"
          icon={<Terminal size={15} aria-hidden="true" />} options={sessions.length ? [
            { value: "", label: "未附着终端" },
            ...sessions.map((row) => {
              const folder = projectFolder(row.cwd);
              const duplicate = sessions.some((other) => other !== row && projectFolder(other.cwd) === folder);
              return { value: sessionKey(row), label: duplicate ? `${folder} · ${row.pid}` : folder, detail: row.cwd };
            }),
          ] : []} />
        <div className="h-full min-w-3 flex-1" data-tauri-drag-region />
        <span className="connection-dot" data-state={selected ? bridge.connection : "none"}
          title={!selected ? "未附着" : bridge.connection === "connected" ? "已连接" : "未连接"} />
        <span className="toolbar-divider" />
        <button className="icon-button" type="button" title="置顶" aria-label="置顶" aria-pressed={alwaysOnTop} disabled={!ready || pinPending} onClick={() => void togglePin()}>
          {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowOpacity(false); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.querySelector("button")?.focus(); setShowOpacity(false); } }}>
          <button className="icon-button" type="button" title="透明度" aria-label="透明度" aria-expanded={showOpacity} disabled={!ready} onClick={() => setShowOpacity(!showOpacity)}>
            <Contrast size={15} />
          </button>
          {showOpacity && (
            <div className="popup absolute right-0 top-full z-30 mt-1 w-44 p-3">
              <label className="text-xs" htmlFor="opacity">不透明度 <output>{Math.round(opacity * 100)}%</output></label>
              <input id="opacity" className="mt-2 block w-full accent-(--accent)" type="range" min="0.35" max="1" step="0.01" value={opacity}
                onChange={(event) => usePreferences.setState({ opacity: event.currentTarget.valueAsNumber })}
                onPointerUp={commitOpacity} onKeyUp={commitOpacity} onBlur={commitOpacity} />
            </div>
          )}
        </div>
        <button className="icon-button" type="button" title="设置" aria-label="设置" onClick={() => void invoke("open_settings").catch(report)}><Settings size={15} /></button>
        <button className="icon-button" type="button" title="隐藏到托盘" aria-label="隐藏到托盘" onClick={() => void mainWindow.hide().catch(report)}><Minus size={17} /></button>
      </header>
      {selected ? <ChatPane key={`${selected}:${bridge.snapshot?.sessionId ?? ""}`} terminal={bridge} ready={ready} report={report} /> : (
        <div className="min-h-0 flex-1">
          <div className="empty-chat" role="status">
            <Terminal size={22} aria-hidden="true" />
            <strong>未附着 Pi 终端</strong>
            <p>{sessions.length ? "从顶栏选择要附着的 Pi 终端。" : <>请在已加载 pi-float 扩展的 Pi 终端中运行 <code>/ui</code>。</>}</p>
          </div>
        </div>
      )}
      <NotificationStack notices={bridge.notifications} dismiss={bridge.dismissNotification} />
    </div>
  );
}
