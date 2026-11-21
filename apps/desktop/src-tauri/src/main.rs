#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod standalone;
mod terminals;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WindowEvent,
};

#[derive(Clone, Default, Debug, PartialEq, Serialize)]
struct LaunchArgs {
    cwd: Option<String>,
    port: Option<u16>,
}

impl LaunchArgs {
    fn parse(args: impl IntoIterator<Item = String>) -> Self {
        let mut launch = Self::default();
        let mut args = args.into_iter().skip(1).peekable();
        while let Some(arg) = args.next() {
            let (flag, value) = match arg.split_once('=') {
                Some((flag, value)) => (flag, Some(value.to_owned())),
                None if arg == "--cwd" || arg == "--port" => {
                    let value = if args.peek().is_some_and(|next| !next.starts_with("--")) {
                        args.next()
                    } else {
                        None
                    };
                    (arg.as_str(), value)
                }
                None => (arg.as_str(), None),
            };
            match (flag, value) {
                ("--", _) => break,
                ("--cwd", Some(value)) if !value.is_empty() => launch.cwd = Some(value),
                ("--port", Some(value)) => {
                    launch.port = value.parse().ok().filter(|port| *port != 0)
                }
                _ => {}
            }
        }
        launch
    }

    fn relative_to(mut self, cwd: &std::path::Path) -> Self {
        if let Some(target) = self.cwd.as_mut() {
            let path = cwd.join(&*target);
            *target = std::path::absolute(&path)
                .unwrap_or(path)
                .to_string_lossy()
                .into_owned();
        }
        self
    }
}

#[tauri::command]
fn launch_args(state: State<'_, Mutex<LaunchArgs>>) -> LaunchArgs {
    state.lock().expect("launch args lock").clone()
}

fn show_window(app: &AppHandle, label: &str, raise: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    window.show()?;
    window.unminimize()?;
    if raise && !window.is_always_on_top()? {
        // Raise on activation without changing the user's pinned preference.
        window.set_always_on_top(true)?;
        let focus = window.set_focus();
        window.set_always_on_top(false)?;
        focus
    } else {
        window.set_focus()
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    show_window(&app, "settings", false).map_err(|error| error.to_string())
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show-main", "显示主窗", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide-main", "隐藏主窗", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &settings, &quit])?;
    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("bundled window icon")
                .clone(),
        )
        .tooltip("pi-float")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let result = match event.id.as_ref() {
                "show-main" => show_window(app, "main", true),
                "hide-main" => app.get_webview_window("main").map_or(Ok(()), |w| w.hide()),
                "settings" => show_window(app, "settings", false),
                "quit" => {
                    app.exit(0);
                    Ok(())
                }
                _ => Ok(()),
            };
            if let Err(error) = result {
                eprintln!("tray action: {error}");
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let launch = LaunchArgs::parse(args).relative_to(std::path::Path::new(&cwd));
            *app.state::<Mutex<LaunchArgs>>()
                .lock()
                .expect("launch args lock") = launch.clone();
            if let Err(error) = show_window(app, "main", true) {
                eprintln!("activate main: {error}");
            }
            if let Err(error) = app.emit_to("main", "pi-float:launch-args", launch) {
                eprintln!("launch event: {error}");
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Mutex::new(
            LaunchArgs::parse(std::env::args())
                .relative_to(&std::env::current_dir().unwrap_or_default()),
        ))
        .manage(standalone::ActiveRequest::default())
        .invoke_handler(tauri::generate_handler![
            open_settings,
            launch_args,
            terminals::terminal_sessions,
            standalone::start_chat,
            standalone::stop_chat
        ])
        .setup(|app| {
            install_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" || window.label() == "settings" {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("hide window: {error}");
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run pi-float");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> LaunchArgs {
        LaunchArgs::parse(args.iter().map(|arg| (*arg).to_owned()))
    }

    #[test]
    fn accepts_separate_and_inline_arguments() {
        let expected = LaunchArgs {
            cwd: Some(r"C:\My Project".into()),
            port: Some(8765),
        };
        assert_eq!(
            parse(&["pi-float", "--cwd", r"C:\My Project", "--port=8765"]),
            expected
        );
        assert_eq!(
            parse(&["pi-float", r"--cwd=C:\My Project", "--port", "8765"]),
            expected
        );
    }

    #[test]
    fn ignores_missing_invalid_and_after_separator() {
        for port in ["0", "65536", "abc"] {
            assert_eq!(
                parse(&["pi-float", "--cwd", "--port", port, "--", "--port=42"]),
                LaunchArgs::default()
            );
        }
    }
}
