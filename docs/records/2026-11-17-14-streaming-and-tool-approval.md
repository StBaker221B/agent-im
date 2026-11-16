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
  - 把工具加入 `agent.approvedTools`（单工具），不改变 `toolsMode`；重建 runtime；
  - 以人类身份发一条「已批准使用 X，请继续刚才的任务。」并 @ 该 agent；
  - agent 用人话继续，只有这个工具被加进 `--tools/--allowedTools`。
- 设置页显示「已批准工具」chip，点 × 可撤销；`PATCH approvedTools` 也可直接改。
- 这是**合作式、turn 后申请**，不是执行前拦截；批准是单工具、持久授权，直到撤销。

## 安全修复：toolsMode=off 曾经没有真正关闭

- 旧 `toolArgsFor` 对 off 返回 `[]`，Claude CLI 默认 `auto` 权限模式，仍然可以 Edit/Write。
- 实测：pm toolsMode=off 时直接创建了 `hello.txt`/`hello2.txt`。
- 第一次修复：抽到 `app/tool-policy.mjs`，off 传 `--permission-mode dontAsk`；`mergeToolArgs` 在 Gateway 建 runtime 时重新应用策略。
- 第二次发现：`dontAsk` 无 allow-list **仍然放行 Read**（pm 在 off 下读了 hello4）。必须同时传 `--tools ""` 才能彻底关闭工具。
- 最终策略：
  - off 且无批准：`--tools "" --permission-mode dontAsk`；
  - off/template + 批准：`--tools <批准+模板工具> --allowedTools <同一列表>`；
  - full：`--tools`/`--allowedTools` 全部；
  - template 也用 `--tools` 限制可用集合，避免未列出的 Read/Edit 被 CLI 默认放行。
- 模型在没有工具时会输出假的 DSML/XML tool call；`parseReply` 把它转成 `tool_request`（提取 `invoke name`），不再把原始 XML 发到房间。
- 复测：
  - pm off + 无批准 → 创建 hello3 被拒，回复 `REQUEST_TOOL: PowerShell`；批准 PowerShell 后创建成功，但仍 `toolsMode=off`、`approvedTools=["PowerShell"]`。
  - pm off + 无批准 → 读 hello4 时输出 DSML；被转成 `tool_request: Read`；批准 Read（单工具）后正常读出 `hello4`。
  - `--tools ""` 的 CLI 测试：init `tools=[]`，模型无法执行 Read。

## 边界

- 审批在 turn 结束后，不是工具调用前；工具已经失败/被拒，模型再申请。
- 批准是单工具、持久；不改变 toolsMode。仍然是弱沙箱，CLI 内的工具参数/命令不受沙箱限制。
- 流式只流最终文本 delta；工具参数/思考过程不流。
- SSE 每标签一条连接；服务重启会重连，没有事件回放。

## 执行前审批（调研，未实现）

想从“turn 后申请”升级成“工具执行前挂起等人类”，协议已经摸清（参考本机 OpenClaw 的 Claude CLI transport）：

- 启动加 `--permission-mode manual --permission-prompts host`，并保持 `--input-format stream-json --output-format stream-json`。
- CLI 在工具调用前从 stdout 发：
  ```json
  {"type":"control_request","request_id":"...","request":{"subtype":"can_use_tool","tool_name":"Edit","input":{...},"tool_use_id":"..."}}
  ```
- 宿主往 stdin 回：
  ```json
  {"type":"control_response","response":{"subtype":"success","request_id":"...","response":{"behavior":"allow"}}}
  ```
  deny 用 `{"behavior":"deny","message":"..."}`。
- 设计取舍：
  - Read/Glob/Grep 自动 allow，PowerShell/Edit/Write 才问人类；
  - Gateway 在 `#runTurn` 收到 permission_request 后发 Matrix 审批卡 + SSE，await 人类响应；
  - 超时（如 5 分钟）自动 deny；拒绝后模型继续/放弃，不杀 turn；
  - 审批 API/UI 与现有 tool_request 类似，但会**阻塞当前 turn**，floor 不释放；
  - `--tools` 仍需列出所有可能调用的工具，权限由 control_request 控制，而不是 allowedTools。
- 未做的原因：会引入阻塞 turn、超时、SSE 断线重连、审批卡状态同步等一整套状态机；当前合作式 v1 已够用。真正需要时再上。

## 下一步

- 执行前工具审批（上面的 control_request 方案）或 worktree 沙箱。
- SSE 事件回放/断线补发。
- 批准工具的过期/按 thread 授权；目前是 agent 级持久 grant。
