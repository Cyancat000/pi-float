import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MainWindow } from "./main-window";
import { loadPreferences, usePreferences, watchPreferences } from "./preferences";
import { SettingsWindow } from "./settings-window";
import "./styles.css";

const currentWindow = getCurrentWindow();
const isSettings = currentWindow.label === "settings";

function App() {
  const theme = usePreferences((prefs) => prefs.theme);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

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

  const reportedError = error ? { message: error, dismiss: () => setError("") } : undefined;
  return isSettings ? <SettingsWindow ready={ready} report={report} error={reportedError} />
    : <MainWindow ready={ready} report={report} error={reportedError} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
