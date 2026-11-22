import { invoke, isTauri } from "@tauri-apps/api/core";

const MAX_PASTE_BYTES = 50 * 1024 * 1024;
const imageExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/bmp": "bmp", "image/tiff": "tiff", "image/svg+xml": "svg", "image/avif": "avif",
};

export function localFileUris(uriList: string, windows: boolean): string[] {
  const lines = uriList.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const paths: string[] = [];
  for (const line of lines) {
    try {
      const url = new URL(line);
      if (url.protocol !== "file:" || url.search || url.hash || (!windows && url.host)) return [];
      const path = decodeURIComponent(url.pathname);
      if (/\p{Cc}/u.test(path)) return [];
      if (windows) {
        if (!url.host && !/^\/[a-z]:\//i.test(path)) return [];
        paths.push(url.host ? `\\\\${url.host}${path.replaceAll("/", "\\")}` : path.slice(1).replaceAll("/", "\\"));
      } else {
        paths.push(path);
      }
    } catch { return []; }
  }
  return paths;
}

export function formatPastedPaths(paths: readonly string[], before: string, after: string): string {
  if (paths.some(path => /\p{Cc}/u.test(path))) throw new Error("剪贴板路径包含控制字符");
  return `${before && !/\s/.test(before) ? " " : ""}${paths.join("\n")}${after && !/\s/.test(after) ? " " : ""}`;
}

// The event's DataTransfer must be read synchronously; only the File blobs and
// strings returned here survive when the async native clipboard call resolves.
export function readPathPaste(data: DataTransfer): (() => Promise<string[]>) | undefined {
  const files = Array.from(data.files);
  const windows = /^Win/i.test(navigator.platform);
  const uriPaths = localFileUris(data.getData("text/uri-list"), windows);
  const native = isTauri();
  if (!files.length && !uriPaths.length && (data.getData("text/plain") || !windows || !native)) return;
  return async () => {
    if (windows && native) {
      const paths = await invoke<string[]>("clipboard_file_paths");
      if (paths.length) return paths;
    }
    if (uriPaths.length) return uriPaths;
    if (files.reduce((total, file) => total + file.size, 0) > MAX_PASTE_BYTES) {
      throw new Error("剪贴板文件总大小不能超过 50 MiB");
    }
    const paths = [];
    for (const file of files) {
      const extension = imageExtensions[file.type] ?? /\.([a-z\d]{1,16})$/i.exec(file.name)?.[1] ?? "";
      paths.push(await invoke<string>("save_clipboard_blob", await file.arrayBuffer(), {
        headers: { "x-pi-float-extension": extension },
      }));
    }
    return paths;
  };
}
