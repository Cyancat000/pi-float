import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, Contrast, Minus, Pin, PinOff, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { projectFolder, sessionKey, useTerminalBridge, type LaunchTarget } from "./bridge-client";
import { ChatPane } from "./chat-pane";
import { NotificationStack } from "./notification-stack";
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
      <header className="flex h-[34px] shrink-0 items-center border-b border-white/10 pl-2 pr-1" data-tauri-drag-region>
        <label className="relative flex items-center">
          <span className="sr-only">Pi 终端</span>
          <select className="mode-select max-w-[150px] truncate" value={selected} onChange={(event) => bridge.select(event.currentTarget.value)}>
            <option value="">未附着终端</option>
            {sessions.map((row) => <option key={sessionKey(row)} value={sessionKey(row)} title={row.cwd}>{projectFolder(row.cwd)}{sessions.filter(({ cwd }) => projectFolder(cwd) === projectFolder(row.cwd)).length > 1 ? " · " + row.pid : ""}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5" size={12} />
        </label>
        <div className="h-full flex-1 cursor-default" data-tauri-drag-region />
        <button className="icon-button" type="button" title="置顶" aria-label="置顶" aria-pressed={alwaysOnTop} disabled={!ready || pinPending} onClick={() => void togglePin()}>
          {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowOpacity(false); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.querySelector("button")?.focus(); setShowOpacity(false); } }}>
          <button className="icon-button" type="button" title="透明度" aria-label="透明度" aria-expanded={showOpacity} disabled={!ready} onClick={() => setShowOpacity(!showOpacity)}>
            <Contrast size={15} />
          </button>
          {showOpacity && (
            <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-white/15 bg-[#252b37] p-3 shadow-lg">
              <label className="text-xs" htmlFor="opacity">不透明度 <output>{Math.round(opacity * 100)}%</output></label>
              <input id="opacity" className="mt-2 block w-full accent-sky-400" type="range" min="0.35" max="1" step="0.01" value={opacity}
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
          <p className="empty-chat" role="status">
            <span>{sessions.length ? "从顶栏选择要附着的 Pi 终端。" : <>暂无可附着的终端。请在已加载 pi-float 扩展的 Pi 终端中运行 <code>/ui</code>。</>}</span>
          </p>
        </div>
      )}
      <NotificationStack notices={bridge.notifications} dismiss={bridge.dismissNotification} />
    </div>
  );
}
