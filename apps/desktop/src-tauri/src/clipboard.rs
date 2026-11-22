use std::io::Write;

use tauri::ipc::{InvokeBody, Request};

const MAX_PASTE_BYTES: usize = 50 * 1024 * 1024;

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Clipboard paste is only available in the main window".into())
    }
}

#[tauri::command]
pub async fn clipboard_file_paths(window: tauri::WebviewWindow) -> Result<Vec<String>, String> {
    main_only(&window)?;
    file_paths().map_err(|err| err.to_string())
}

#[cfg(target_os = "windows")]
fn file_paths() -> std::io::Result<Vec<String>> {
    use std::{io, ptr};
    use windows_sys::Win32::{
        System::{
            DataExchange::{
                CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
            },
            Ole::CF_HDROP,
        },
        UI::Shell::DragQueryFileW,
    };

    struct Open;
    impl Drop for Open {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    let format = u32::from(CF_HDROP);
    // Explorer puts actual paths (including folders) in CF_HDROP. Webview File
    // objects deliberately omit these paths. The clipboard owns the HDROP.
    unsafe {
        if IsClipboardFormatAvailable(format) == 0 {
            return Ok(Vec::new());
        }
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err(io::Error::last_os_error());
        }
        let _open = Open;
        if IsClipboardFormatAvailable(format) == 0 {
            return Ok(Vec::new());
        }
        let drop_files = GetClipboardData(format);
        if drop_files.is_null() {
            return Err(io::Error::last_os_error());
        }
        let count = DragQueryFileW(drop_files, u32::MAX, ptr::null_mut(), 0);
        (0..count)
            .map(|index| {
                let length = DragQueryFileW(drop_files, index, ptr::null_mut(), 0);
                let mut units = vec![0; length as usize + 1];
                if length == 0
                    || DragQueryFileW(drop_files, index, units.as_mut_ptr(), length + 1) != length
                {
                    return Err(io::Error::other("Cannot read clipboard file path"));
                }
                String::from_utf16(&units[..length as usize]).map_err(io::Error::other)
            })
            .collect()
    }
}

#[cfg(not(target_os = "windows"))]
fn file_paths() -> std::io::Result<Vec<String>> {
    Ok(Vec::new())
}

#[tauri::command]
pub fn save_clipboard_blob(
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> Result<String, String> {
    main_only(&window)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary clipboard data".into());
    };
    let extension = request
        .headers()
        .get("x-pi-float-extension")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    save_blob(bytes, extension).map_err(|err| err.to_string())
}

fn save_blob(bytes: &[u8], extension: &str) -> std::io::Result<String> {
    if bytes.len() > MAX_PASTE_BYTES {
        return Err(std::io::Error::other("Clipboard file exceeds 50 MiB"));
    }
    if extension.len() > 16 || !extension.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(std::io::Error::other("Invalid clipboard file extension"));
    }
    let suffix = if extension.is_empty() {
        String::new()
    } else {
        format!(".{extension}")
    };
    let mut file = tempfile::Builder::new()
        .prefix("pi-float-clipboard-")
        .suffix(&suffix)
        .tempfile()?;
    file.write_all(bytes)?;
    // Keep the file available to Pi after the paste and after the desktop exits.
    let path = file
        .path()
        .to_str()
        .ok_or_else(|| std::io::Error::other("Clipboard temp directory is not valid Unicode"))?
        .to_owned();
    file.keep().map_err(|err| err.error)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_unique_files_with_the_requested_extension_and_bytes() {
        let a = save_blob(b"image data", "png").unwrap();
        let b = save_blob(b"", "png").unwrap();
        assert_ne!(a, b);
        assert!(std::path::Path::new(&a).is_absolute());
        assert!(a.ends_with(".png"));
        assert_eq!(std::fs::read(&a).unwrap(), b"image data");
        assert_eq!(std::fs::read(&b).unwrap(), b"");
        std::fs::remove_file(a).unwrap();
        std::fs::remove_file(b).unwrap();
    }

    #[test]
    fn rejects_an_extension_with_path_separators() {
        assert!(save_blob(b"", "../png").is_err());
    }
}
