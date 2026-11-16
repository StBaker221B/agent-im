# 2026-11-17-14 流式输出与工具审批

- 记录时间：2026-11-17 上午。
- 状态：v1 已通：token 流、工具申请/批准闭环、tools off 硬拒绝；真正的执行前审批和强沙箱未做。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [14 角色与计划](../14-role-templates-and-roadmap.md) · [12 权限/triage](2026-11-16-12-permissions-triage-usage.md)

## 流式输出

- ClaudeAdapter 加 `--include-partial-messages`，解析 `stream_event` 的 `content_block_delta/text_delta`，产出 `text_delta` 事件；最终文本仍以 `assistant` 全量消息为准。
- Gateway 加 `onEvent`：
  - `turn_start`
  - `text_delta`（增量）
  - `tool_use` / `tool_result`
  - `turn_end`
  - `skip`（triage/budget/paused）
- Server 加 `GET /api/events`（SSE，20s heartbeat）；浏览器用 `EventSource` 订阅。
- UI 在消息流末尾渲染实时气泡：累加 delta、光标闪烁、显示正在使用的工具；`turn_end` 后移除，等 Matrix 最终消息落库。
- 实测 pm 一条消息：SSE 13 个 text_delta + turn_start/turn_end，文本逐字出现。

## 工具申请/批准

- 系统提示（`composeSystemPrompt`）现在列出“当前可用工具”；需要不可用工具时，要求回复：
  `REQUEST_TOOL: <工具名> <原因>`
- `parseReply` 增加 `tool_request`；Gateway 把它当 outbound 消息发送，intent=`tool_request`，Matrix 自定义字段 `com.agentim.tool` 带工具名。
- UI 在申请消息下显示「批准 X 并继续（开启完整工具）」按钮。
- `POST /api/agents/:id/approve-tool {tool,roomId}`：
  - 把 agent 切到 `toolsMode=full`，重建 runtime；
  - 以人类身份发一条「已批准使用 X，请继续刚才的任务。」并 @ 该 agent；
  - agent 用人话继续，工具已可用。
- 这是**合作式、turn 后申请**，不是执行前拦截；批准后是 full 权限，不是单工具白名单。

## 安全修复：toolsMode=off 曾经没有真正关闭

- 旧 `toolArgsFor` 对 off 返回 `[]`，Claude CLI 默认 `auto` 权限模式，仍然可以 Edit/Write。
- 实测：pm toolsMode=off 时直接创建了 `hello.txt`/`hello2.txt`。
- 修复：抽到 `app/tool-policy.mjs`：
  - claude + off 也传 `--permission-mode dontAsk`（无 allowedTools = 全部拒绝）；
  - template 无 allow 同样；
  - `mergeToolArgs` 在 Gateway 建 runtime 时重新应用策略，清理 state 里过期的 `--permission-mode/--allowedTools`。
- 复测：pm off → 创建 hello3 被拒，回复 `REQUEST_TOOL: PowerShell ...`；批准后创建成功，`hello3.txt` 内容正确。

## 边界

- 审批在 turn 结束后，不是工具调用前；工具已经失败/被拒，模型再申请。
- 批准等于 full 工具，不是只批准一个工具；批准后仍然是弱沙箱。
- 流式只流最终文本 delta；工具参数/思考过程不流。
- SSE 每标签一条连接；服务重启会重连，没有事件回放。

## 下一步

- 执行前工具审批（Claude CLI `--permission-prompts host` / control_request）或 worktree 沙箱。
- 单工具 grant，而不是 full。
- SSE 事件回放/断线补发。
