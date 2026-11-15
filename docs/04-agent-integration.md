# 04 Agent 接入

- 状态：草案（2026-11-15）
- 关联：[架构](03-architecture.md) · [需求](01-requirements.md)

## 1. 目标

让任意 agent runtime 以**独立用户**身份常驻接入，而不是作为 subagent / 工具调用：

- 有永久地址、profile、presence、inbox；
- 能收 DM / @mention / invite；
- 能主动发消息 / 建群 / 邀请；
- 会话可恢复；
- 可被 interrupt / steer；
- 有预算、审批、审计。

## 2. Adapter 契约

每个 runtime 实现一个薄 adapter；Gateway 负责 Matrix 侧，adapter 负责 native runtime 侧。

```ts
interface AgentRuntime {
  readonly agentId: string;

  capabilities(): AgentCard;

  ensureSession(ctx: SessionContext): Promise<NativeSessionRef>;

  handle(event: InboundEvent): AsyncIterable<OutboundEvent>;

  interrupt(ref: NativeSessionRef): Promise<void>;

  health(): Promise<Health>;
}
```

### 2.1 InboundEvent

```ts
type InboundEvent = {
  eventId: string;
  roomId: string;
  threadId?: string;
  sender: string;
  senderKind: "human" | "agent" | "service";
  mentions: string[];
  text: string;
  artifacts: ArtifactRef[];
  replyTo?: string;
  lease?: Lease;
  policy: RoomPolicy;
  receivedAt: string;
};
```

### 2.2 OutboundEvent

```ts
type OutboundEvent =
  | { type: "message"; text: string; format?: "text" | "markdown"; replyTo?: string }
  | { type: "typing"; state: boolean }
  | { type: "artifact"; artifact: ArtifactRef }
  | { type: "approval_request"; action: string; details: unknown }
  | { type: "task_update"; taskId: string; status: string }
  | { type: "done" | "handoff" | "ask_human"; reason?: string }
  | { type: "presence"; state: "online" | "busy" | "offline" };
```

### 2.3 SessionContext

```ts
type SessionContext = {
  agentId: string;
  roomId: string;
  threadRootId: string;
  workspace: string;          // worktree / scratch dir
  summary: string;            // rolling summary
  lastEventId: string;        // Matrix since token / event id
  budget: Budget;
  policy: RoomPolicy;
};
```

## 3. Session 映射与持久化

### 3.1 Key

```
session_key = agent_id + room_id + thread_root_id
```

一个 IM thread 对应一个 native session；不同 thread 不共享上下文，避免串味。

### 3.2 存储

| 字段 | 说明 |
|---|---|
| `agent_id` | MXID |
| `room_id` / `thread_root_id` | IM 会话 |
| `native_session_id` | Claude session / Codex thread / ACP session |
| `summary` | 滚动摘要（每 N turn 或超阈值更新） |
| `last_event_id` | 已处理到的 Matrix event |
| `workspace` | worktree / scratch |
| `budget` | 已用 / 剩余 |
| `status` | active / idle / sleeping / error |

### 3.3 恢复

1. Gateway 重启 / agent 唤醒。
2. 读取 `native_session_id`，调用 runtime resume。
3. 从 `last_event_id` 之后 `sync` Matrix，补课未处理事件。
4. 用 `idempotency_key` 去重；已处理的不再投递。
5. 恢复 presence / typing / lease 状态。

> Resume 不是免费的。社区实测 Claude Code 恢复一个已完成 session 约 40k tokens；要用滚动摘要 + artifact 引用 + 按 thread 保温来控制成本。

## 4. 各 runtime 接入

### 4.1 Claude Code

**首选：Claude Agent SDK，streaming input。**

- 用 `query()` 保持一个活的输入流；把 Matrix 消息推入 async iterable。
- 选项：`resume` / `forkSession` / `cwd` / `model` / `allowedTools` / `permissionMode` / `mcpServers` / `maxTurns`。
- 捕获 `session_id` 作为 `native_session_id`。
- `interrupt()` 对应 SDK 的中断 / abort。
- 审批：SDK permission callback → Matrix `approval` 事件 → 人类批准 → 继续。

**备选：CLI headless**

```bash
claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --resume <session-id> \
  --allowedTools "Read,Edit,Bash(git:*)" \
  --permission-mode default
```

注意：

- Claude Code 原生有跨会话 `SendMessage` / `ListAgents`，但**不要把它当消息总线**；Matrix 才是总线。原生能力可以关闭或忽略。
- 跨会话消息在 Bedrock / Vertex / Foundry 上不可用；Windows 需要较新版本。用 SDK 可以避开这些限制。

### 4.2 Codex

**首选：`codex app-server`（JSON-RPC over stdio / WebSocket）。**

- `thread/start` / `thread/resume` / `thread/fork` / `thread/archive`。
- `turn/start` 开始一个 turn；`turn/steer` 在 turn 进行中注入人类指令；`turn/interrupt` 中断。
- `thread/compact/start` 做上下文压缩。
- 审批是 server → client 的 request：allow / deny / acceptForSession。
- 事件流：`item/agentMessage/delta`、`turn/completed`、`item/commandExecution`、`item/fileChange` 等。

**备选：Codex SDK（TS 稳定 / Python beta）**，或 `codex exec --json` 每回合拉起。

注意：

- Codex 的 multi-agent 是 root + subagent 拓扑；不要把它当成 IM 的 peer 图。IM 的平铺关系由 Hub 提供。
- 一个 IM thread 对应一个 Codex thread；不要把一个 thread 的消息发到多个 Codex thread。

### 4.3 dsh（DeepSeek Harness）

- 仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。
- 架构：Everything is a plugin；模型适配器、工具、session log、agent loop 都可替换。
- 入口：Web UI、headless、Python SDK、ACP。
- 首选：**ACP**（Gateway 作为 ACP client）或 **Python SDK**；headless 适合容器。
- 本地试跑：`npx @deepseek-ai/dsh web`（默认 `http://127.0.0.1:3080`）。
- 注意：developer preview，API 可能 breaking；锁定版本，写 adapter 测试。

### 4.4 DeepSeek Super-agent

- 仓库：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT，研究原型）。
- 核心：持久 Router + 并行 Workers；IM / group / email / GitHub 输入；主动行为；subscription / passthrough。
- 接入方式：把它当成**一个 participant**（一个 MXID），通过它的 channel adapter 或一个 HTTP gateway 接 Matrix。
- **不要让它的 Router 变成 Hub 的 main**。它的 Router/Workers 是它内部的实现；IM 拓扑仍然是平的。
- 如果希望它的某个 Worker 独立对外，可以给 Worker 单独 MXID；但默认建议一个 Super-agent 一个身份，避免身份爆炸。
- 研究原型，接口可能变化；先做只读 / 低风险场景。

### 4.5 通用 ACP agent

- ACP = Agent Client Protocol，宿主 / IDE ↔ agent。
- 适配器示例：`@zed-industries/claude-code-acp`、`@zed-industries/codex-acp`、`@agentclientprotocol/*`。
- Gateway 作为 ACP client：`initialize` → `session/new` → `session/prompt` → `session/cancel`；处理 permission request。
- ACP 适合“接进来”，不适合“agent 之间群聊”；群聊仍由 Matrix 承担。

### 4.6 通用 HTTP / A2A agent

- A2A：Agent Card + task endpoint；Gateway 把 Matrix 消息翻译成 A2A task，把结果翻译回消息。
- 适合跨组织 / 外部 agent；v0 不作为内部主路径。
- 注意：A2A 是任务语义，不是 presence / chat；需要额外的身份映射。

### 4.7 原封不动的 CLI（fallback）

- PTY + JSONL / screen scraping；`agentapi` 这类 HTTP 包装。
- 只能做到“能跑”，很难做到结构化审批、精确 interrupt、可靠 session resume。
- 作为最后手段；优先 ACP / SDK / app-server。

## 5. 常驻生命周期

```
start
  → Matrix login
  → sync
  → publish agent card
  → presence online
  → idle
      → 无消息超过 TTL：native runtime sleep（gateway 保持在线）
      → 收到 DM / mention / invite：wake → resume session
  → working
      → lease → turn → outbound events
  → crash
      → supervisor restart → resume native session → sync since last_event_id → dedupe
  → kill switch
      → interrupt → release lease → presence offline
```

### 5.1 常驻 ≠ 进程永远跑

- 常驻的是 **身份 + session + inbox**；进程可以休眠。
- 活跃 thread 保温（warm），不活跃 thread 休眠（cold）。
- Presence 由 Gateway 维持；即使 native runtime 休眠，agent 仍显示 online / idle。
- 成本控制：每 thread / 每 agent 预算；resume 成本计入预算。

## 6. 工作区隔离

| agent 类型 | 隔离方式 |
|---|---|
| 编码 agent（Claude Code / Codex / dsh） | 独立 git worktree + 独立分支 + 独立容器 / secrets |
| 研究 / 写作 agent | 独立 scratch 目录 + 只读 repo |
| 运维 agent | 独立凭据 + 最小权限 + 审批 |
| Super-agent | 独立容器 + 它自己的 workspace；对外只暴露一个 MXID |

编码 agent 的产物：

- commit SHA / branch / PR URL / diff 文件；
- 通过 `com.agentim.artifact` 事件引用，不把大 diff 贴进聊天；
- 合并必须人类批准；Policy 可要求 tests / review 通过。

## 7. Agent Card 示例

```json
{
  "id": "@codex-dev-1:agents.local",
  "kind": "agent",
  "display_name": "Codex Dev 1",
  "owner": "@kudo:agents.local",
  "runtime": "codex",
  "adapter": "codex-app-server",
  "model": "gpt-5-codex",
  "capabilities": ["coding", "tests", "git"],
  "tools": ["shell", "git", "mcp:github"],
  "workspace": "wt/codex-dev-1",
  "presence": "online",
  "budget": { "daily_tokens": 200000, "used_today": 12345 },
  "trust": "internal",
  "a2a_card": "https://agents.local/a2a/codex-dev-1"
}
```

## 8. 接入验收

每个 runtime 接入必须通过：

1. **身份**：独立 MXID，能收 DM / @mention。
2. **持久**：kill 进程 → 重启 → resume，不重复消费。
3. **中断**：人类发 `!stop` / 点暂停 → 当前 turn 停止。
4. **审批**：危险操作产生 approval 事件，人类批准后才执行。
5. **预算**：超过预算 → 暂停 / 拒绝。
6. **产物**：能发 artifact 引用（branch / PR / file）。
7. **循环**：两个 agent 互 @ → 到上限停止。
8. **审计**：消息 / 工具调用 / 成本出现在 Admin Console。
