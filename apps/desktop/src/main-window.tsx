import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Contrast, Maximize2, Minimize2, Minus, Pin, PinOff, Settings, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { app as tauriApp } from "../src-tauri/tauri.conf.json";
import { projectFolder, sessionKey, useTerminalBridge, type LaunchTarget } from "./bridge-client";
import { ChatPane } from "./chat-pane";
import { CompactPane } from "./compact-pane";
import { NotificationStack } from "./notification-stack";
import { Picker } from "./picker";
import { savePreference, usePreferences } from "./preferences";

const mainWindow = getCurrentWindow();
const normalConfig = tauriApp.windows.find(({ label }) => label === "main")!;
const normalMinimum = new LogicalSize(normalConfig.minWidth!, normalConfig.minHeight!);
const compactSize = new LogicalSize(300, 108);
const compactMinimum = new LogicalSize(260, compactSize.height);

export function MainWindow({ ready, report }: { ready: boolean; report: (error: unknown) => void }) {
  const bridge = useTerminalBridge(report);
  const { attach, selected, sessions } = bridge;
  const [showOpacity, setShowOpacity] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const [normalWindow, setNormalWindow] = useState<{ size: LogicalSize; maximized: boolean }>();
  const [modePending, setModePending] = useState(false);
  const compact = normalWindow !== undefined;
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

  async function toggleCompact() {
    setModePending(true);
    let maximized = false;
    let originalSize: LogicalSize | undefined;
    try {
      if (normalWindow) {
        await mainWindow.setMinSize(normalMinimum);
        await mainWindow.setSize(normalWindow.size);
        if (normalWindow.maximized) await mainWindow.maximize();
        setNormalWindow(undefined);
      } else {
        maximized = await mainWindow.isMaximized();
        if (maximized) await mainWindow.unmaximize();
        const [size, scale] = await Promise.all([mainWindow.innerSize(), mainWindow.scaleFactor()]);
        originalSize = size.toLogical(scale);
        await mainWindow.setMinSize(compactMinimum);
        await mainWindow.setSize(compactSize);
        setShowOpacity(false);
        setNormalWindow({ size: originalSize, maximized });
      }
    } catch (error) {
      // Keep the displayed mode and native window constraints in sync on failure.
      try {
        if (normalWindow) {
          await mainWindow.setMinSize(compactMinimum);
          await mainWindow.setSize(compactSize);
        } else {
          await mainWindow.setMinSize(normalMinimum);
          if (originalSize) await mainWindow.setSize(originalSize);
          if (maximized) await mainWindow.maximize();
        }
      } catch (restoreError) { console.error(restoreError); }
      report(error);
    } finally {
      setModePending(false);
    }
  }

  const compactSnapshot = selected && bridge.connection === "connected" ? bridge.snapshot : null;
  const emptyMessage = !selected ? "未附着 Pi 终端" : compactSnapshot ? "暂无消息"
    : bridge.connection === "connecting" ? "正在连接 Pi 终端…" : "Pi 终端未连接";

  return (
    <div className="floating-shell relative flex h-full flex-col overflow-hidden" style={{ opacity }}>
      <header className={compact ? "titlebar compact-titlebar" : "titlebar"} data-tauri-drag-region>
        {compact ? <span className="compact-title" data-tauri-drag-region>紧凑模式</span> : <Picker label="Pi 终端" value={selected} onChange={bridge.select} fallback="未附着终端"
          icon={<Terminal size={15} aria-hidden="true" />} options={sessions.length ? [
            { value: "", label: "未附着终端" },
            ...sessions.map((row) => {
              const folder = projectFolder(row.cwd);
              const duplicate = sessions.some((other) => other !== row && projectFolder(other.cwd) === folder);
              return { value: sessionKey(row), label: duplicate ? `${folder} · ${row.pid}` : folder, detail: row.cwd };
            }),
          ] : []} />}
        <div className="h-full min-w-3 flex-1" data-tauri-drag-region />
        <span className="connection-dot" data-state={selected ? bridge.connection : "none"}
          title={!selected ? "未附着" : bridge.connection === "connected" ? "已连接" : "未连接"} />
        {!compact && <>
          <span className="toolbar-divider" />
          <button className="icon-button" type="button" title="置顶" aria-label="置顶" aria-pressed={alwaysOnTop} disabled={!ready || pinPending} onClick={() => void togglePin()}>
            {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
          <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowOpacity(false); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.querySelector("button")?.focus(); setShowOpacity(false); } }}>
            <button className="icon-button" type="button" title="透明度" aria-label="透明度" aria-expanded={showOpacity} disabled={!ready} onClick={() => setShowOpacity(!showOpacity)}>
              <Contrast size={15} />
            </button>
            {showOpacity && (
              <div className="popup opacity-popup absolute right-0 top-full z-30 mt-1 w-44 p-3">
                <label className="text-xs" htmlFor="opacity">不透明度 <output>{Math.round(opacity * 100)}%</output></label>
                <input id="opacity" className="mt-2 block w-full accent-(--accent)" type="range" min="0.35" max="1" step="0.01" value={opacity}
                  onChange={(event) => usePreferences.setState({ opacity: event.currentTarget.valueAsNumber })}
                  onPointerUp={commitOpacity} onKeyUp={commitOpacity} onBlur={commitOpacity} />
              </div>
            )}
          </div>
          <button className="icon-button" type="button" title="设置" aria-label="设置" onClick={() => void invoke("open_settings").catch(report)}><Settings size={15} /></button>
        </>}
        <button className="icon-button" type="button" title={compact ? "恢复完整窗口" : "紧凑模式"}
          aria-label={compact ? "恢复完整窗口" : "紧凑模式"} disabled={!ready || modePending} onClick={() => void toggleCompact()}>
          {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
        </button>
        <button className="icon-button" type="button" title="隐藏到托盘" aria-label="隐藏到托盘" onClick={() => void mainWindow.hide().catch(report)}><Minus size={17} /></button>
      </header>
      {compact && <CompactPane snapshot={compactSnapshot} emptyMessage={emptyMessage} />}
      {/* Keep the composer mounted so switching views doesn't lose the unsent draft or undo history. */}
      <div className={compact ? "hidden" : "contents"}>
        {selected ? <ChatPane key={`${selected}:${bridge.snapshot?.sessionId ?? ""}`} terminal={bridge} ready={ready} report={report} visible={!compact} /> : (
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
      </div>
    );
  }
