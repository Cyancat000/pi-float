# pi-float

Pi 的悬浮聊天窗。附着正在运行的 Pi 终端，沿用该会话的模型、工具和扩展。

## 安装（Windows）

1. 在终端安装 Pi 桥接扩展（需要 Pi 1.6+、Node.js 22.12+ 或 20.19+、Git）：

   ```bash
   pi install git:github.com/Cyancat000/pi-float@v1.0.0
   ```

2. 到 [GitHub Releases](https://github.com/Cyancat000/pi-float/releases) 下载 Windows x64 的 `pi-float.exe`，放到你想保留的位置，**双击一次**。桌面端会为当前用户记住自身位置；不用管理员权限，不用改 `PATH`。
3. 启动 Pi（已打开的会话可执行 `/reload`），输入 `/float-ui` 打开并附着当前终端。若移动过 `pi-float.exe`，退出旧实例并在新位置双击一次即可更新记录。

如果之前通过绝对路径手动加载过桥接扩展，先从 Pi 的 `settings.json` 的 `extensions` 数组移除旧入口，避免加载两份。

## 本地开发

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

- 点击顶栏「紧凑模式」按钮，将浮窗缩为只显示最新一条聊天消息和当前待办的小窗。待办进度显示为已完成数 / 总数（如 `3/5`）；点击「恢复完整窗口」可回到原来的尺寸，输入草稿仍会保留。
- 在浮窗右上角打开「设置 → 外观 → 主题」。默认的 **Light** 保留原有浅灰配色；也可选择参考 [Atom One Dark](https://github.com/atom/one-dark-ui)、[GitHub Primer](https://github.com/primer/primitives)、[Nord](https://github.com/nordtheme/nord) 或 [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) 的配色。选择后主窗和设置立即更新，重启后保留。
- 在 Pi 输入 `/float-ui`，或从桌面顶栏选项目目录，附着该终端。也可用 `pi-float.exe --port <端口>` 或 `pi-float.exe --cwd <项目路径>` 启动或唤醒桌面窗；多个同目录会话时以端口精确指定。
- 「＋ 新建会话」在当前终端的工作区开始新对话；「历史会话」列出该工作区其他已保存的会话，点击即可恢复。也可以在浮窗输入 `/new` 或 `/resume`。这些操作会同步切换终端和浮窗，不会删除原会话；回复过程中不可切换。
- 「会话树」查看当前会话的分支。选中节点并确认后，用户消息会切到发送前，助手回复会保留到该节点；不生成摘要，旧分支仍可切回。只有 Pi 空闲时可以切换。
- 中止或报错后，最近一轮如果有可重放的纯文本提示，会显示「重试」。它从原提示重新生成，不撤销文件修改或已执行的操作，工具也可能再次运行。
- 在浮窗消息框输入 `/` 可查看当前会话通过 Pi API 提供的扩展命令、提示模板和技能。继续输入过滤，用 ↑/↓ 选择，Tab 补全后可追加参数，Enter 或点击执行，Esc 关闭列表。命令需要终端空闲；Pi 自身的交互界面和命令确认仍在终端显示，未列出的 TUI 内置命令请在终端执行。更新后请在终端执行 `/reload` 再运行 `/float-ui`，以加载新版桥接扩展。
- 在消息框按 `Ctrl+V`（macOS 为 `⌘V`）可粘贴文件和图片路径。Windows 资源管理器复制的文件和文件夹会插入原始绝对路径，多项时每行一条；截图等只有剪贴板数据的内容会保存到系统临时目录，插入临时文件路径。仅插入文本，不会自动发送。
- 当前附着会话的扩展通知（`ctx.ui.notify()`）会作为临时提示显示，不进入聊天历史。旧版桥接仍可附着和聊天，但不会转发通知。详见 [Pi 通知与 API 限制](docs/pi-notifications.md)。
- 浮窗的「待办」面板展示当前会话分支的任务，右上角标注来源。无需安装第三方插件：默认由 pi-float 桥接扩展的 `pi_float_todo` 工具管理，可以在对话里请助手创建、更新或清空任务。检测到 `@juicesharp/rpiv-todo` 时，改为只读显示插件在 TUI 中使用的同一份任务（已验证兼容 2.15.0 的状态格式）；其他待办插件暂不支持同步，浮窗继续使用自己的独立清单。两种来源不合并，也不自动迁移任务。
- 模型列表来自附着的 Pi 会话，切换模型也由 Pi 执行。插话交给 Pi 的 `steer` 队列；选择「未附着终端」只会断开悬浮窗，不会中止 Pi。
- `/float-ui` 按顺序查找 `PI_FLOAT_BIN`、Windows 桌面端登记的位置、`PATH` 和仓库中的 release/debug 二进制。`PI_FLOAT_BIN` 是显式覆盖；如果此前设置过该变量，请清除旧值或改成正确路径。开发时也可直接运行 `tauri dev`。
- 活跃终端和本地连接令牌在 `~/.pi-float/sessions.json`；不要共享该文件。
- 如果旧版曾保存独立聊天的 API Key，新版不再使用这些配置。可退出 pi-float 后，从其应用数据目录的 `preferences.json` 删除 `providers` 字段，其他界面设置可以保留。

## 构建 Windows `.exe`

```powershell
pnpm --filter @pi-float/desktop tauri build --no-bundle
```

产物：`apps/desktop/src-tauri/target/release/pi-float.exe`（无安装器，依赖系统 WebView2）。可将其放入 `PATH` 或把 `PI_FLOAT_BIN` 指向该文件。

Pi API 与投影依据见 [`docs/pi-bridge-spec.md`](docs/pi-bridge-spec.md)。
