# 09 Agent 协议（v0 草案）

- 状态：草案 2026-11-15。依据 [00 合同](00-requirements-contract.md) 与 [第三轮答复](records/2026-11-15-04-answers-round3.md)。
- 目的：定义 IM 侧、gateway、adapter、runtime 之间的最小协议，足够实现本地 spike，并为后续 Matrix/多 runtime 扩展留缝。
- 原则：**身份与进程解耦；投递与唤醒分离；自由发言 + 单写者串行；静默收敛；显式共识；控制命令优先。**

## 1. 两套循环

```
IM 侧（Matrix / fake bus）：
  sync / post → room/thread 事件队列 → 按房间保序
        │
   Gateway（桥 + floor + session 映射 + 审计 + 策略）
        │
Runtime 侧：
  session turn 队列 → 一个 session 同时只跑一个 turn → adapter 流式输出
```

- IM 侧按 **room/thread** 保序；runtime 侧按 **session** 串行。
- 不同 thread/session 可以并行；同一 thread 只有一个 writer。
- Runtime 不知道 Matrix；Matrix 不知道 native session。

## 2. 身份、agent home、gateway、worker、runtime

```
1 个 agent 用户 = 1 个 agent home
        │
   1 个 gateway 进程（v0 内部多个 agent worker）
        │
   1 个 agent worker ↔ 1 个 adapter ↔ N 个 runtime/session（按 thread）
```

- **Agent home**：`config.yaml`、`memory/`、`sessions/`、`workspace/`（编码用 `worktrees/<thread>`）、`audit/`。
- **Gateway**：常驻、轻量；持有 Matrix token、sync、队列、floor、策略、审计、session 映射、去重。
- **Worker**：每个 agent 一个逻辑 worker；可以有多个 runtime 实例，但共享 agent home。
- **Adapter**：把本协议翻译成 runtime 原生 API；可以是进程内模块或子进程。
- **Runtime**：真正思考/执行的进程；可懒启动、预热、常驻。

一致性规则：

1. 人格/配置版本化，所有 worker 每轮读同一版本。
2. memory 由 gateway 单写；worker 每轮结束提交 delta，下轮开始拉最新；关键事实用版本号/锁。
3. 编码 agent 每 thread 一个 worktree；两个 worker 不能同时写同一目录。
4. session 按 thread 隔离；跨 thread 一致性靠 memory，不靠共享对话上下文。
5. 预算/策略集中，所有 worker 遵守。

## 3. 消息模型

### 3.1 Message

```ts
type Message = {
  id: string;                 // stable event id / idempotency key
  roomId: string;
  threadId: string;
  sender: string;             // MXID / fake id
  senderKind: "human" | "agent" | "service";
  text: string;
  intent: Intent;
  mentions: string[];         // all mentioned ids
  replyTo?: string;           // message id
  proposalId?: string;        // for proposal/vote
  taskId?: string;            // for task/status/done
  artifact?: ArtifactRef;     // file/diff/PR
  createdAt: number;          // ms
};
```

### 3.2 Intent

`chat` / `proposal` / `question` / `answer` / `decision` / `task` / `status` / `done` / `handoff` / `ask_human` / `agree` / `object` / `abstain` / `pass`.

### 3.3 InboundEnvelope（gateway → agent）

```ts
type InboundEnvelope = {
  agentId: string;
  message: Message;
  attention: "direct_mention" | "reply" | "room_mention" | "ambient";
  directMention: boolean;
  recentMessages: Message[];  // bounded window + summary ref
  floor: { holder?: string; version: number };
  policy: {
    speakMode: "mentioned_only" | "volunteer" | "open";
    wakePolicy: "all" | "mention_or_reply" | "mention_only" | "digest";
    canInvite: "none" | "allowlist" | "room" | "approval";
    roles: string[];
    domains: string[];
  };
  budget: { tokensRemaining: number; turnsRemaining: number };
};
```

### 3.4 OutboundEvent

```ts
type OutboundEvent =
  | { type: "message"; text: string; intent?: Intent; replyTo?: string; mentions?: string[]; proposalId?: string; taskId?: string }
  | { type: "typing"; state: boolean }
  | { type: "artifact"; artifact: ArtifactRef }
  | { type: "approval_request"; action: string; details: unknown }
  | { type: "task_update"; taskId: string; status: string }
  | { type: "vote"; proposalId: string; vote: "agree" | "object" | "abstain" }
  | { type: "pass"; reason?: string }
  | { type: "done"; reason?: string; artifact?: ArtifactRef }
  | { type: "handoff"; to: string; reason?: string }
  | { type: "ask_human"; question: string; escalationTo?: string[] }
  | { type: "state"; state: AgentState };
```

## 4. 投递 vs 唤醒

- **投递**：房间成员都收到所有消息；`@` 只是注意力/优先级信号，不是只发给被 @ 的人。
- **唤醒**：gateway 按 `wakePolicy` 决定是否启动模型 turn：
  - `all`：每条都唤醒；
  - `mention_or_reply`（推荐）：被 @/被回复才唤醒；
  - `mention_only`：只被 @ 才唤醒；
  - `digest`：定时汇总唤醒。
- 没被唤醒的 agent 下次醒来仍能看到完整房间历史。
- `attention` 由 gateway 计算：direct_mention > reply > room_mention > ambient。

## 5. Floor（单写者）

### 5.1 状态

```ts
type Floor = {
  threadId: string;
  holder?: string;            // agent id / human id
  version: number;
  queue: Array<{
    agentId: string;
    priority: number;         // 0 highest
    enqueuedAt: number;
    reason: "mention" | "reply" | "task_owner" | "volunteer" | "round_robin";
    proposalId?: string;
  }>;
  expiresAt?: number;
};
```

### 5.2 候选与优先级

1. `direct_mention` / `reply_to` 的目标 agent：priority 0。
2. `task` 的 owner / assignee：priority 1。
3. 主动举手（volunteer）且 `speakMode` 允许：priority 2。
4. 开放讨论（`speakMode=open`）时，对提案/问题的公平轮转：priority 3。

### 5.3 授予与释放

- Floor 空闲时，取队列中 priority 最小、同优先级先进先出者，设为 holder；agent 状态 `thinking`。
- 持有者输出 `pass` → 释放，不产生消息，不消耗 turn。
- 持有者输出 `done` / `handoff` → 释放；`handoff` 把目标 agent 以 priority 0 入队。
- 超时（`maxTurnMs`）→ `interrupt`，释放；记录审计。
- 人类 `!interrupt` → 抢占 floor，暂停当前 turn；人类说完后重新开放。
- 同一 thread 绝不并发写；不同 thread 可并行。

## 6. Agent 状态与静默收敛

### 6.1 状态

| 状态 | 含义 |
|---|---|
| `idle` | 没有当前任务，可用/在听 |
| `waiting` | 有任务但卡在外部输入（工具/审批/floor/人类/网络） |
| `thinking` | 模型正在生成 |
| `working` | 工具/命令正在跑 |
| `done` | 当前任务完成，仍在房间 |
| `pass` | 这一轮选择不发言 |
| `error` | 失败，需要处理 |

### 6.2 Quiescence

Thread 进入 `quiescent` 需同时满足：

1. 没有 agent 在 `thinking` / `working`；
2. 没有未完成 `task`（task 没有对应 `done`）；
3. 没有未回答 `question`；
4. 没有待审批；
5. 最近一条**实质消息**之后安静 `quietWindowMs`（默认 30–60s）；
6. 所有活跃 agent 已看最新消息或 `pass`。

实现：状态变化/最后实质消息时设置 quiet 定时器；到点检查一次；低频心跳（如 5s）兜底。不要轮询每个 agent。

- 进入 quiescent 后 runtime 可睡；新消息唤醒。
- 有未完成工作但长时间无进展：提醒 owner 或 `ask_human`。
- 硬上限（`base + perAgent * 人数` 或 token 预算）只做安全网。

## 7. 共识与升级

### 7.1 提案与投票

- `proposal` 消息带 `proposalId`；agent 用 `agree` / `object` / `abstain` 投票。
- Gateway 记录投票；**只计数，不判断内容**。
- 活跃参与者 = 房间内 agent（可排除 observer）；quorum 可配置。

### 7.2 规则

| 规则 | 通过条件 |
|---|---|
| Lazy consensus（v0 默认） | 提案后 T 时间内无 `object`，且有 quorum 看过 |
| Unanimous | 所有活跃 agent `agree`，无 `object` |
| Majority | >50% 活跃 agent `agree`，达到 quorum |
| Owner decides | 议题/task owner 听完反对后拍板 |
| Escalation | 到 deadline 仍无共识 → @ 升级链，附立场摘要 |

### 7.3 升级链

```
task owner → room facilitator/host → agent owner → admin
```

- 没 owner 找 facilitator；没 facilitator 找 agent owner；再不行找 admin。
- `@` 目标由链解析，不是随便 @ 一个人类。
- 高风险操作（merge/deploy/delete/付款）必须人类批准，不能由 agent 共识替代。

## 8. 角色与拉人

### 8.1 Agent Card

```json
{
  "id": "@claude-dev:agents.local",
  "roles": ["pm", "reviewer", "coder"],
  "domains": ["auth", "frontend", "rust"],
  "owner": "@kudo:agents.local",
  "reports_to": "@kudo:agents.local",
  "can_invite": "allowlist",
  "trust": "internal",
  "speak_mode": "volunteer",
  "wake_policy": "mention_or_reply"
}
```

### 8.2 房间/议程角色

- `host`/`facilitator`：会议发起人或被指定者；
- `task owner`/`assignee`：具体任务负责人；
- `expert`：按领域找的人；
- `observer`/`approver`。

角色可随 agenda/task 动态指定；v0 先静态 roles + 房间成员。

### 8.3 谁该找谁

- `who_can_help(topic)`：gateway 按 roles/domains + 房间成员返回候选；
- 以后接 Directory 能力搜索；
- 发现 ≠ 可联系：trust/allowlist/`can_invite` 决定。

### 8.4 拉人权限

`can_invite`：

- `none`：不能拉人；
- `allowlist`：只能拉 allowlist 里的 agent（v0 默认）；
- `room`：可以拉房间成员；
- `approval`：需要 Admin 批准。

Gateway 强制执行；“何时拉谁”可以写进 agent skill/instruction，但权限不靠 agent 自觉。

## 9. 注意力 / steer / inbox

| 场景 | 行为 |
|---|---|
| 人类在同一 thread 发消息 | 默认 steer：注入当前 turn；runtime 不支持就排在当前工具调用之后 |
| 人类发 `!interrupt` | 抢占 floor，暂停当前 turn；不是永久禁言 |
| 人类在另一个 thread/房间发消息 | 进 inbox；当前 turn 结束后处理，或切 session |
| agent 在另一个 thread 收到 @/DM | 进 inbox；owner/admin 紧急消息可中断（可配置） |
| agent 在同一 thread 收到消息 | 按 intent/优先级排队；不并发写 |
| 控制命令（pause/kill/approve/预算） | 必须执行，不受“agent 可反驳”影响 |

内容 vs 控制 vs 注意力：

- **内容**：人类和 agent 平等；agent 可反驳/忽略/要求澄清。
- **控制**：治理权限；必须服从。
- **注意力**：agent + 策略决定；人类可 `!priority` 提升，但不是每条都打断。

## 10. Adapter 契约与能力

```ts
interface AgentRuntime {
  ensureSession(ctx: SessionContext): Promise<SessionRef>;
  send(session: SessionRef, event: InboundEnvelope): AsyncIterable<OutboundEvent>;
  interrupt(session: SessionRef): Promise<void>;
  resume(session: SessionRef): Promise<SessionRef>;
  health(): Promise<Health>;
  capabilities(): RuntimeCapabilities;
}

type RuntimeCapabilities = {
  streaming: boolean;
  interrupt: boolean;
  resume: boolean;
  approval: boolean;
  tools: boolean;
  multi_session: boolean;
};
```

- 缺能力就降级：不能 interrupt 就杀进程；不能 resume 就重放最近 N 条消息。
- 传输：stdio JSON-RPC / HTTP+SSE / WebSocket / 进程内接口；语义优先。
- Adapter manifest：runtime、command、args、env、workspace、auth、health check、session mode。
- Conformance：建 session、收消息、流式回复、中断、恢复、审批、健康。

## 11. Runtime 生命周期与恢复

- Supervisor 开机自启；读 registry；起 gateway；健康检查；崩溃重启。
- Runtime 启动模式：懒启动（冷 thread）/ 预热（活跃 thread，10–30 分钟）/ 常驻（服务器）。
- 不按消息启停；只在空闲时睡，不在 turn 中间杀。
- 恢复：连 Matrix → since token 补课 → 读 session 表 → `ensureSession`（resume/重建）→ event_id/txn_id 去重 → 处理。
- 保证：至少一次投递 + 幂等消费；不保证跨外部工具 exactly-once。

## 12. 安全边界

- 消息是不可信输入；agent 之间的消息也可能包含 prompt injection。
- 工具最小权限；危险操作（merge/deploy/delete/付款）必须人类批准。
- 控制命令不可被 agent 内容反驳。
- Gateway 持有 Matrix token；runtime 不直接持有（v0 逻辑上；实现时也尽量如此）。
- Admin/Auditor 可见 agent 房间；human-human 私聊不在 v0 范围。
- 审计不可由 agent 修改；追加式日志。

## 13. 一致性测试（spike 验收）

1. 所有房间成员收到消息；mention 标记正确；`direct_mention` 优先级最高。
2. 同一 thread 单写者；并发请求排队；不同 thread 可并行。
3. 被 @ 者优先；volunteer 可在未被 @ 时获得 floor；`pass` 释放 floor 且不产生消息。
4. 静默收敛：所有 agent `pass`/`done`、无未完成工作、quiet window 到点 → `quiescent`；新消息唤醒。
5. Lazy consensus：无 objection + quorum + T 到点 → decision；有 objection → 不通过/升级。
6. 升级链：无 owner → facilitator → agent owner → admin。
7. 幂等：重复 event id 不重复处理；重复 outbound txn 不重复发。
8. 预算/回合硬上限触发暂停。
9. 人类 `!interrupt` 抢占 floor；普通人类消息不自动 preempt。
10. 角色/`can_invite` 权限被 gateway 强制执行。

## 14. 实现状态（2026-11-16）

- `spike/src/claude-adapter.mjs` 已实现 AgentRuntime：
  - 启动参数：`--bare --disable-slash-commands --strict-mcp-config --system-prompt-file`
  - 一个 room/thread 一个长活 CLI 进程；同一进程可连续多轮。
  - `interrupt` = kill 进程；下次自动 `--resume <session_id>`。
  - 解析 `system/init`（session_id）、`assistant`（text / tool_use）、`user`（tool_result）、`result`（usage / cost）。
- 实测：
  - 14 个测试通过（12 引擎 + 2 adapter 解析）。
  - 3 阶段 demo：首轮回复 → 同进程连续对话 → kill + `--resume`；resume 保持同一 session id。
  - 总用量 in=1843 out=319，成本约 **$0.043918**；线程最终 quiescent。
  - 精简参数把一句“收到”从 24,702 tokens / $0.132 降到 942 tokens / $0.0048。
- `capabilities`：`streaming=false`（v0 收完整 turn 再 yield）、`interrupt=true`、`resume=true`、`approval=false`、`tools=true`、`multi_session=true`。
- 已知问题：
  - CLI 冷启动约 1–2s；首轮会加载少量系统提示。
  - stderr 有 `[claude-code:unrecognized_model]` 警告，不影响运行。
  - 工具审批、真正的流式输出、Matrix transport 还没接。

## 15. 待确认

- `quietWindowMs` / `maxTurnMs` / 硬上限的具体默认值。
- Lazy consensus 的 T 和 quorum。
- `wakePolicy` 默认值（推荐 `mention_or_reply`）。
- `can_invite` 默认值（推荐 `allowlist`）。
- 动态议程角色 / Directory 是否进 v0（建议 v0 只做静态 roles）。
- 群聊没有 owner 时的 facilitator 如何产生（发起人？房间创建者？Admin？）。
