# Pi 扩展通知

## 在 Pi 1.6.0 中的路径

`pi-git-commit` 扩展的 `/toggle-allow-git` 处理器调用 `ctx.ui.notify(message, "warning")`（切回限制时为 `info`）。交互模式的 `showExtensionNotify` 再调用 `showWarning` 等方法；终端里的 `Warning:` 前缀由 TUI 添加，不是通知正文。

Pi 1.6.0 的公开 API 只能**发出**这类通知，没有观察其他扩展通知的事件。`ui_prompt_start` / `ui_prompt_end` 仅用于阻塞式交互；公开的扩展事件总线也不会自动收到通知。RPC 模式有 `extension_ui_request` 的 `notify` 方法，但不是已运行的 TUI 会话的订阅接口。

当前桥接用兼容适配层包装 Pi TUI 的共享 `ctx.ui.notify`，仅在会话有效且有连接时转发，并保留原调用。共享可写 UI 对象是当前实现细节，**不是公开的监听契约**。如果 Pi 不再共享该对象、将方法设为只读，或通知绕过此对象（例如 Pi 自身直接调用 `showWarning`），则不会捕获。桥接不读终端屏幕，不改 Pi 安装文件，也不识别具体命令或提示文本。

## WebSocket

仍使用 `pi-float.v1`；新增可选服务端事件：

```json
{ "type": "notification", "sessionId": "…", "sequence": 1, "level": "warning", "message": "原始正文" }
```

- 等级为 `info`、`warning`、`error`；Pi 调用未传等级时为 `info`。
- 每次实际通知调用只广播一次，两种命令入口使用同一路径。序号在每次桥接注册的生命周期内递增，不按文本去重，所以同文的新通知仍会显示。
- 通知只推给当前连接，不写入会话或快照、不补发。浮窗只接受当前已连接会话的事件，忽略重复序号，并在断线或换会话时清空提示。
- 不发此事件的旧桥接无需升级协议即可继续附着、收发聊天。

## 验证

- 在加载了当前桥接和 `pi-git-commit` 的测试会话中附着浮窗。在 TUI 执行一次 `/toggle-allow-git`，浮窗应只显示一条 Warning；从浮窗再次执行，应只新增一条 Info。再用测试扩展的 `ctx.ui.notify("第一行\n第二行", "error")` 检查 Error 的级别和换行。聊天历史在这些操作前后不变。
- 断开连接再重连，或从顶栏切换到另一会话再切回来：旧提示应消失，断开期间和其他会话的通知不应补发。重新附着后，同样文字的新通知仍应显示。
- 附着未更新的桥接，确认快照和普通聊天不受影响。
- 运行适配层的回归测试（Node 22）：`node --experimental-strip-types --test packages/pi-bridge/test/notifications.test.mjs`。

## 建议的 Pi 上游改动

为扩展提供正式的会话级 `ui_notification` 事件（或返回取消订阅函数的等价只读钩子），从宿主处理 `ctx.ui.notify` 的统一入口为每次调用发出一次，携带调用时的会话 ID、原始消息与有效等级（默认 `info`）。它不应阻塞原有 UI、写入消息历史或在订阅时重放。错误隔离和取消订阅由 Pi 管理。等上游提供该契约后，用正式钩子**替换**兼容包装，不同时监听两条路径。
