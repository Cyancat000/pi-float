import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MainWindow } from "./main-window";
import { loadPreferences, usePreferences, watchPreferences } from "./preferences";
import { SettingsWindow } from "./settings-window";
import "./styles.css";

const currentWindow = getCurrentWindow();
const isSettings = currentWindow.label === "settings";

function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const report = useCallback((cause: unknown) => {
    console.error(cause);
    setError("操作失败：" + String(cause));
  }, []);

  useEffect(() => {
    let active = true;
    const subscription = isSettings ? Promise.resolve(undefined) : watchPreferences((cause) => { if (active) report(cause); });
    void subscription.then(loadPreferences).then(async () => {
      if (!active) return;
      if (!isSettings) await currentWindow.setAlwaysOnTop(usePreferences.getState().alwaysOnTop);
      if (active) setReady(true);
    }).catch((cause) => { if (active) report(cause); });
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten?.()).catch(() => {});
    };
  }, [report]);

  return (
    <>
      {isSettings ? <SettingsWindow ready={ready} report={report} /> : <MainWindow ready={ready} report={report} />}
      {error && <div role="alert" className="absolute inset-x-3 bottom-3 rounded bg-red-950 p-2 text-xs text-red-100"><button className="float-right ml-2" aria-label="关闭提示" onClick={() => setError("")}>×</button>{error}</div>}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
