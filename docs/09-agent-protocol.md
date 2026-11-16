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

## 14. 实现状态（2026-11-16，真实 Matrix E2E + MVP 通过）

### 14.1 Runtime / adapter

- `spike/src/claude-adapter.mjs` 已实现 AgentRuntime：
  - 启动参数：`--bare --disable-slash-commands --strict-mcp-config --system-prompt-file`
  - 一个 room/thread 一个长活 CLI 进程；同一进程可连续多轮。
  - `interrupt` = kill 进程；下次自动 `--resume <session_id>`。
  - session id 持久化到 agent home 的 `sessions/claude.json`；gateway 重启后仍能 resume。
  - 解析 `system/init`、`assistant`（text / tool_use）、`user`（tool_result）、`result`（usage / cost）。
- `spike/src/script-peer.mjs`：确定性脚本 participant，实现同一 runtime 契约。
- `spike/src/reply.mjs`：共享 `buildAgentPrompt` / `parseReply`（PASS / ASK_HUMAN / DONE）。
- `capabilities`：`streaming=false`、`interrupt=true`、`resume=true`、`approval=false`、`tools=true`、`multi_session=true`。

### 14.2 Transport / gateway（新增）

- `spike/src/fake-bus.mjs`：进程内假总线，含 room/members、单调 event log、`since` token、txn id 幂等；用于测试和不花钱的 demo。
- `spike/src/matrix-transport.mjs`：Matrix client-server API 传输。
  - 每个 agent 一个 MatrixClient（独立 token）；`sync` 长轮询、`send` 带 txn id、`m.mentions`、`m.thread`、`com.agentim.*` 自定义字段。
  - 支持 `getMessages`（补课/水合）、`getEvent`（thread root）、`members`、`join`、`resolveAlias`。
- `spike/src/gateway.mjs`：Engine ↔ transport ↔ runtime 桥。
  - 每个 agent 自己的 sync loop；全局串行队列保证同 thread 单写者（v0 不同 thread 也串行）。
  - 投递即入 Engine；`wakePolicy` 决定 turn；2 人房间自动视为 direct mention。
  - runtime 输出先落 Matrix（拿到 event id），再 `agentAct`；回复 txn id 由 `(agent, trigger event)` 决定，重试不重复发。
  - 状态持久化：`since` token、已消费 event id、`lastTs`；重启从 since 补课，历史按 `lastTs` 水合为已消费，旧消息不重跑。
  - tick 处理 floor 超时（interrupt runtime）、quiescence、proposal 结果；JSONL 审计。
- `spike/src/supervisor.mjs`：配置加载、agent/runtime/transport 装配、SIGINT 优雅停止。
- `spike/scripts/setup-matrix.mjs`：幂等注册用户、建群 + DM、写本地 config；`scripts/say.mjs` 用人类身份发消息。
- 宿主方案：[12 Matrix 宿主](12-matrix-host-wsl.md)（WSL2 + Tuwunel，单二进制，不用 Docker Desktop）。**2026-11-16 已安装**：WSL2 3.0.5 + Ubuntu 24.04.4、Tuwunel 2.0.0，监听 `127.0.0.1:8008`，`server_name=localhost`。

### 14.3 实测

- **27 个测试通过**：15 引擎（含 `human_all` / agent 链上限）+ 2 adapter 解析 + 4 gateway + 4 Matrix transport + 1 setup-matrix + 1 gateway×Matrix 集成（mock homeserver）。
- 假总线端到端 demo（`npm run gateway-demo`）：群 @mention → Claude(mock) → script peer → PASS → quiescent；DM；主动发言；重启不重跑旧消息、停机期间消息只处理一次；全过。
- 真实 Claude gateway demo（`npm run gateway-demo-claude`）：in=1381 out=648，成本 **$0.059228**；4 条消息后 quiescent。
- **真实 Matrix E2E 通过（2026-11-16，WSL2 + Tuwunel 2.0.0）**：
  - `setup-matrix` 首次运行即成功：注册 `@kudo:localhost`、`@claude-dev:localhost`、`@script-peer:localhost`，建群 `#agent-room:localhost` 与 DM `#agent-room-dm:localhost`。
  - 群 @claude-dev → Claude（真实 CLI）回复并 @script-peer → script peer 回复 → Claude 再收到 → `PASS` → quiescent；DM 无需 @（2 人房间自动 direct）；群里不 @ 任何人只有 inbound、不唤醒。
  - 停机期间发一条 @claude-dev，重启 gateway：`state loaded: since=2 processed=6`，只处理停机那条一次，旧消息不重跑，Claude session 继续 resume。
  - 时间线经 Matrix API 独立读取核对，事件确实落在 homeserver，不只看网关自己的日志。
  - 本轮真实 Claude 成本约 **$0.029**（4 个 turn）。
- 一个观察：人类一条消息同时 @ 两个 agent 时，两个 agent 会并行各回一条（script peer 回的是人类，不是 Claude）；要测 agent→agent 链，需只 @ 第一个 agent，让它自己 @ 第二个。
- 已知限制：
  - 全局队列：不同 thread 暂不并行。
  - 崩溃在 turn 中间：该轮回复会丢（入站先标记已消费），不会重复；v0 接受。
  - thread root 只水合一条；长 thread 的上下文以 native session 为准。
  - 工具审批、真正的流式输出还没做；真实 Matrix 上的审批同样没验证。
  - Tuwunel 目前是 `nohup` 常驻，还没做开机自启（任务计划程序或 systemd）。
  - CLI 冷启动约 1–2s；stderr 有 `[claude-code:unrecognized_model]` 警告，不影响运行。

### 14.4 MVP（2026-11-16）

- 新目录：`app/`（控制面 + gateway 宿主 + Web API）和 `web/`（React + Vite 产品 UI）；协议核心仍复用 `spike/src`。
- 产品形态：单列会话（DM/群混排）+ 聊天窗；`+` 新建私聊/群聊/agent；Agents 页管理参与者。
- 控制面：`POST /api/agents` 注册 Matrix 用户并动态 `gateway.addAgent`；`POST /api/rooms` 建 DM/群并 `gateway.addRoom`；每个 agent 可单独私聊。
- 唤醒默认改为 **`human_all`**：人类消息唤醒所有 agent，由 agent 自己决定回复或 `PASS`；agent 消息只唤醒被 @/回复的；`maxAgentChain=3` 防止互刷。
- 验证：新建 `@researcher` → DM 回复；群「讨论组」不 @ 发一条 → claude-dev 和 researcher 都回复；DM claude-dev 不 @ 也回复。
- 成本：4 个真实 turn 约 **$0.146**；`human_all` 的成本随 agent 数线性增长，下一步要 triage/冷却/预算。
- **第二轮（同日下午）**：
  - `ClaudeAdapter.sessionScope="agent"`：一个 agent 一个 session，跨房间共享 transcript。实测群里说的 `海豚-7` 在私聊能答出；私聊暗号在群里记得但按隐私规则拒绝复述。
  - 群聊可邀请 agent（`POST /rooms/:id/members`）；会话可删除（所有成员 leave）；新建 agent 拆成独立弹窗。
  - 图片/文件消息（≤8MB）：服务端上传到 Matrix media，`/api/media` 用认证 v1 端点代理下载。
- **第三轮（同日下午）**：
  - 媒体缓存到 `app/data/media`，agent 消息带本地路径；系统提示要求先 Read 再回答。实测能读出图片里的 `VISION-OK 42`。
  - `@` 同时解析 localpart 和 displayName（含中文）；直接提问/私聊必须回应，修复 researcher 过度 PASS。
  - 历史搜索（每房间最近 100 条）、设置页 PATCH agent、列表右键/⋯删除、头像资料。
  - "正在思考/排队中"改为 Engine `room.activity`（floor/queue），PASS 后自动消失。
  - **讨论模式**（`room.mode=discussion`）：agent 链上限 3→6；prompt 要求对另一个 agent 的具体观点 @ 对方继续；群聊头部可切换。`#dispatch` 记录已跑过的 agent，避免同一条消息里重复 PASS。
- 设计、数据、API、限制见 [13 MVP 架构](13-mvp-architecture.md) 与 [记录 06](records/2026-11-16-06-mvp-round2.md) / [记录 07](records/2026-11-16-07-mvp-round3.md) / [记录 08](records/2026-11-16-08-discussion-mode.md)。

## 15. 待确认

- `quietWindowMs` / `maxTurnMs` / 硬上限的具体默认值。
- Lazy consensus 的 T 和 quorum。
- `wakePolicy` 默认值：产品默认 `human_all`（人类消息全员判断）；spike 测试默认 `mention_or_reply`。成本控制（triage/冷却/预算）待定。
- `can_invite` 默认值（推荐 `allowlist`）。
- 动态议程角色 / Directory 是否进 v0（建议 v0 只做静态 roles）。
- 群聊没有 owner 时的 facilitator 如何产生（发起人？房间创建者？Admin？）。
