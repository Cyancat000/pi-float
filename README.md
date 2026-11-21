# pi-float

Pi 的暗色悬浮聊天窗。附着正在运行的 Pi 终端，沿用该会话的模型、工具和扩展。

## 开发与安装扩展

需要 Pi、Node.js 22.12+（或 Node 20.19+）、pnpm 10.29.2、Rust 和 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)（Windows：MSVC / WebView2）。在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @pi-float/desktop tauri dev
```

在另一个终端进入要使用 Pi 的项目，加载扩展（Windows 示例，将路径改为你的仓库路径）：

```powershell
pi -e 'D:\pi-float\packages\pi-bridge\src\index.ts'
```

若要每次启动都加载，将同一个扩展文件的**绝对路径**加到 Pi agent `settings.json` 的 `extensions` 数组。保留此仓库和已安装的依赖，不要只复制入口文件。

## 使用

- 在 Pi 输入 `/ui`，或从桌面顶栏选项目目录，附着该终端。也可用 `pi-float.exe --port <端口>` 或 `pi-float.exe --cwd <项目路径>` 启动或唤醒桌面窗；多个同目录会话时以端口精确指定。
- 「＋ 新建会话」在当前终端的工作区开始新对话；「历史会话」列出该工作区其他已保存的会话，点击即可恢复。也可以在浮窗输入 `/new` 或 `/resume`。这些操作会同步切换终端和浮窗，不会删除原会话；回复过程中不可切换。
- 在浮窗消息框输入 `/` 可查看当前会话通过 Pi API 提供的扩展命令、提示模板和技能。继续输入过滤，用 ↑/↓ 选择，Tab 补全后可追加参数，Enter 或点击执行，Esc 关闭列表。命令需要终端空闲；Pi 自身的交互界面和命令确认仍在终端显示，未列出的 TUI 内置命令请在终端执行。更新后请在终端执行 `/reload` 再运行 `/ui`，以加载新版桥接扩展。
- 当前附着会话的扩展通知（`ctx.ui.notify()`）会作为临时提示显示，不进入聊天历史。旧版桥接仍可附着和聊天，但不会转发通知。详见 [Pi 通知与 API 限制](docs/pi-notifications.md)。
- 模型列表来自附着的 Pi 会话，切换模型也由 Pi 执行。插话交给 Pi 的 `steer` 队列；选择「未附着终端」只会断开悬浮窗，不会中止 Pi。
- `/ui` 查找 `PI_FLOAT_BIN`、`PATH`、仓库中的 release/debug 二进制。开发时先运行 `tauri dev`；若自定义了构建路径，设置 `PI_FLOAT_BIN` 为二进制绝对路径。
- 活跃终端和本地连接令牌在 `~/.pi-float/sessions.json`；不要共享该文件。
- 如果旧版曾保存独立聊天的 API Key，新版不再使用这些配置。可退出 pi-float 后，从其应用数据目录的 `preferences.json` 删除 `providers` 字段，其他界面设置可以保留。

## 构建 Windows `.exe`

```powershell
pnpm --filter @pi-float/desktop tauri build --no-bundle
```

产物：`apps/desktop/src-tauri/target/release/pi-float.exe`（无安装器，依赖系统 WebView2）。可将其放入 `PATH` 或把 `PI_FLOAT_BIN` 指向该文件。

Pi API 与投影依据见 [`docs/pi-bridge-spec.md`](docs/pi-bridge-spec.md)。
