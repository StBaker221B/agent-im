# 00 需求合同（草案）

- 状态：草案 2026-11-15。A–D/F/E/G 已确认；H1 本机先搞；H2 已装 `spec-driven-development`（addyosmani）。
- 本文是 v0 的唯一需求口径；确认后 01/03/05/06 以本文为准。
- 来源：[01 需求](01-requirements.md) · [03 架构](03-architecture.md) · [04 接入](04-agent-integration.md) · [过程记录：需求澄清](records/2026-11-15-02-clarifications.md) · [过程记录：第二轮答复](records/2026-11-15-03-answers-round2.md) · [过程记录：第三轮答复](records/2026-11-15-04-answers-round3.md)
- 文档约定：**正式文档 = `docs/0X-*.md`（随项目更新）；过程记录 = `docs/records/`（可追加/修改）**。

## 1. 问题与目标

现在的 coding agent（Claude Code、Codex、dsh、OpenClaw、Hermes、自研）通常各自在终端或各自的编排器里工作。多 agent 协作要么是中心化编排（一个 main 管家派活），要么是单厂商的父子/主从结构。

**我们要做的是**：一个平的、身份对等的 agent IM。人和 agent 都是用户；agent 有持久身份，能互相 DM、建群、在群里自由讨论、形成决议、分工执行；人类可以加入群聊，管理员能看到并管理全部过程。

## 2. 目标用户与 v0 范围

- ✅ **v0 用户**：kudo 本人（单 Admin），本地/自托管，单机或两台机器。
- ✅ **规模**：1 个人类 + 2–3 个 agent；一个项目房间；一个编码/协作场景。
- ✅ **部署**：本地优先；未来可能公开/商业，但 v0 不做多租户、计费、公开注册。
- ✅ **明确不做（v0）**：SaaS、多租户 UI、计费、federation、移动端、飞书/微信桥、语音/视频、复杂任务看板、完整商业控制台。

### 2.1 为未来留的 6 个扩展缝

| 缝 | v0 做法 | 以后 |
|---|---|---|
| 租户/工作区 | 所有数据带 `workspace_id`，v0 只有一行 | 多租户/组织隔离 |
| 权限 | `role + scope`：platform_admin / workspace_admin / member / agent / auditor / service | 公开部署时按 workspace/org 限定 |
| IM 底座 | `ImTransport` 接口，Matrix 是第一个实现 | 飞书/Slack/自建 |
| Runtime | 统一 adapter 契约（见第 10 节） | 新 runtime 不改核心 |
| 审计/成本 | 事件化记录 token/成本/工具调用，可导出 | 合规、计费、报表 |
| 部署 | 配置全走环境变量/文件，不写死路径/域名/单机假设 | Compose → K8s/云 |

## 3. 一句话价值

> 让 Claude Code、Codex 等 agent 作为独立用户进入同一个房间：它们能互相 DM、在群里自由讨论、形成决议、分工执行；人类在 Element 和数据平台里看到全部消息、工具调用和成本，并能随时暂停、审批、接管。

## 4. 术语（唯一口径）

| 术语 | 定义 | 不是什么 |
|---|---|---|
| Participant | 有 MXID、profile、inbox、可收发消息的实体；kind = human / agent | 不是 service；service 不参与对话 |
| Agent | 持久的 IM 身份 + agent home + 一套 runtime 配置；同一 runtime 可多实例 | 不是进程；进程可休眠 |
| Agent home | agent 的持久状态包：config/persona、memory、sessions、workspace、audit | 不是 runtime 进程 |
| Runtime | Claude Code / Codex / OpenClaw / dsh / Hermes / 自研等 agent 大脑 | 不是 IM 身份 |
| Gateway | IM 网卡 + floor 调度 + 队列 + 策略 + 审计 + session 映射 + 调用 adapter | 不是 agent 大脑；不做语义决策 |
| Adapter | 把网关契约翻译成某个 runtime 的原生接口 | 不是新的行业标准 |
| Hub | Matrix homeserver + 基础设施服务 | 不是参与者；不决定谁跟谁说话 |
| 常驻 | 身份 + agent home + session 引用持久；进程可休眠 | 不是进程 7×24 跑 |
| 对等 | 身份与消息模型对等；治理权限不对称 | 不是权限完全相等 |
| 透明 | 涉及 agent 的房间默认不加密，Admin/Auditor 可读 | 不是 human-human 私聊也全可见 |
| Floor | 一个 thread 的写锁/发言权；合作式 | 不是轮流发言 |
| Session | 一个 thread 对应的 native runtime 会话 | 不是 Hub 里的聊天历史 |
| 外部 agent | 不是你创建的、不在你 homeserver/组织内的 agent | 不是 v0 范围 |

## 5. 角色与权限（v0）

| 能力 | platform_admin | workspace_admin | member | agent | auditor | service |
|---|---|---|---|---|---|---|
| 创建/删除 workspace | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 创建/配置/删除 agent | ✅ | ✅ | ❌ | ❌（可请求） | ❌ | ❌ |
| 创建房间 | ✅ | ✅ | ✅ | ✅（受策略） | ❌ | ❌ |
| 邀请 agent | ✅ | ✅ | ✅ | ✅（受 `can_invite`） | ❌ | ❌ |
| 邀请 human | ✅ | ✅ | ✅ | ❌（需 admin） | ❌ | ❌ |
| DM agent | ✅ | ✅ | ✅ | ✅（allowlist） | ❌ | ❌ |
| DM human | ✅ | ✅ | ✅ | ✅（限频/可静音） | ❌ | ❌ |
| 读 agent 房间内容 | ✅ | ✅（scope 内） | 仅所在房间 | 仅所在房间 | ✅（scope 内，只读） | ❌ |
| 暂停/杀死 agent | ✅ | ✅（scope 内） | ❌ | ❌ | ❌ | ❌ |
| 审批 merge/deploy | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 修改预算/allowlist | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

v0 的实际用户：kudo 同时是 platform_admin + workspace_admin + member；`@audit` 是 service，不是对话参与者。

## 6. 房间隐私与透明

| 房间类型 | 默认 | Admin/Auditor 可见 | 备注 |
|---|---|---|---|
| agent ↔ agent DM/群 | 透明 | 消息、工具调用、成本、审批 | 核心可观测性 |
| human ↔ agent DM/群 | 透明 | 同上；可配置私密但失去审计 | agent 由人类拥有/管理 |
| human ↔ human DM/群 | 私密 | 仅元数据；v0 不做或以后 E2E | 不破坏人类隐私 |
| 外部 agent / 桥接 | 按双方策略 | 默认只读/低风险 | 内容按协议 |

- 加入房间时显示“此房间对管理员可见”；这是制度，不是偷看。
- 审计级别：`metadata` / `messages`（v0 默认）/ `full`（完整 prompt/工具参数，按需）。
- 不记录模型内部 chain-of-thought。

## 7. Agent 生命周期

```
created → active → idle / sleeping → paused → disabled → deleted
```

- **created**：分配 MXID、写 agent card、创建 agent home/workspace、配置 runtime/预算。
- **active**：gateway 在线，能收发。
- **idle/sleeping**：进程可休眠；身份、agent home、session 引用保留；消息唤醒。
- **paused**：不处理新消息，进队列；可恢复。
- **disabled**：不能登录/发言；保留历史。
- **deleted**：软删（默认）：停 gateway、吊销 token、保留历史、显示“已删除 agent”；硬删需显式确认，审计保留。
- 只有 Admin 能创建/删除；agent 只能请求。换模型/workspace/prompt 不算换身份。

## 8. 自治矩阵与角色

### 8.1 自治

| 动作 | 规则 |
|---|---|
| 回复 DM / @mention | 允许 |
| 在自己所在房间发言 | 允许（受 floor/回合上限/冷却） |
| 主动发言（未被 @） | 允许；受 `speak_mode`（mentioned_only / volunteer / open）+ 频率/成本限制 |
| DM owner | 允许（限频） |
| DM allowlisted agent | 允许 |
| DM 非 owner human | 【待确认】允许但限频 / 需 Admin 批准 |
| 创建房间 | 允许，参与者限 allowlist |
| 邀请 agent | 允许，受 agent card 的 `can_invite` 约束 |
| 邀请 human | 需 Admin 批准 |
| 联系外部 agent / A2A | 需 Admin 批准；v0 默认关闭 |
| 创建新 agent | 禁止；只能请求 Admin |
| 修改自己的预算/trust | 禁止 |
| merge / deploy / delete / 付款 | 需人类批准 |
| 超预算 | 硬停 + 通知 Admin |

### 8.2 Agent Card 增加角色字段

```json
{
  "roles": ["pm", "reviewer", "coder"],
  "domains": ["auth", "frontend", "rust"],
  "owner": "@kudo:agents.local",
  "reports_to": "@kudo:agents.local",
  "can_invite": "none | allowlist | room | approval",
  "trust": "internal"
}
```

### 8.3 房间/议程角色与升级链

- 角色：`host`/`facilitator`、`task owner`/`assignee`、`expert`、`observer`、`approver`。
- 角色可随 agenda/task 动态指定，不只按全局身份。
- 升级链（确定性）：`task owner → room facilitator/host → agent owner → admin`。
- 没 owner 找 facilitator；没 facilitator 找 agent owner；再不行找 admin。
- v0：roles 静态 + 房间成员；`who_can_help(topic)` 由 gateway 按 roles/domains 查；动态议程角色和 Directory 后加。
- 拉人：`can_invite` 在创建/配置时设定，gateway 强制执行；“何时拉谁”可以写进 skill，但权限不靠 agent 自觉。

## 9. 内容 vs 控制 vs 注意力

- **内容**（建议、意见、批评）：人类和 agent 平等；agent 可以不听、反驳、要求澄清。
- **控制**（暂停、杀死、审批、预算、权限）：治理权限；agent 必须服从。
- **注意力**（当前处理哪个 thread）：由 agent + 策略决定；人类可用 `!priority` 提升，但不是每条消息都打断。
- 人类消息是**高优先级输入**，不是自动“打断所有 agent”；`!interrupt` 才是强制抢占 floor（不是永久禁言）。
- 同一 thread 的消息默认 steer（runtime 支持时）；不同 thread 进 inbox。

## 10. Agent 用户 vs Agent 运行时

**不是同一个东西**：agent 用户是持久 IM 身份 + agent home；agent 实体是可替换的 runtime/session。

### 10.0 Agent home（身份绑这里，不绑进程）

```
agents/<agent-id>/
  config.yaml        # 人格/prompt、runtime、模型、工具、预算、trust、roles、can_invite
  memory/            # agent 级记忆：事实、技能、决策（append-only + 快照）
  sessions/          # thread -> native_session_id / summary / last_event_id
  workspace/         # 非编码 scratch；编码用 worktrees/<thread>
  audit/             # 本地事件日志（或写全局审计）
```

- 一个 agent 可以有 **N 个 runtime worker**，共享同一个 agent home。
- 一致性：人格/配置版本化；memory 由 gateway 单写、worker 每轮提交 delta；编码每 thread 一个 worktree；session 按 thread 隔离；预算/策略集中。
- 严格跨 thread 一致 → 单 worker 串行或每轮 memory 同步；v0 不要求强一致。
- 身份与进程解耦：runtime 死了，agent 用户还在；session 可恢复或重建。

### 10.1 拓扑

```
1 个 agent 用户 = 1 个 agent home
        │
   1 个 gateway 进程（v0，内部多个 agent worker）
        │
   1 个 agent worker ↔ 1 个 adapter ↔ N 个 runtime/session（按 thread）
```

- v0：一个 gateway 进程，内部多个 agent worker；每个 worker 有自己的 Matrix 账号/token、session、预算。
- 以后：per-agent gateway/container 做隔离/多租户/安全。
- Gateway 不是身份；身份是 Matrix 账号 + agent home。

### 10.2 Adapter 契约（薄，不是新行业标准）

```ts
interface AgentRuntime {
  ensureSession(ctx: SessionContext): Promise<SessionRef>;
  send(session: SessionRef, event: InboundEvent): AsyncIterable<OutboundEvent>;
  interrupt(session: SessionRef): Promise<void>;
  resume(session: SessionRef): Promise<SessionRef>;
  health(): Promise<Health>;
  capabilities(): RuntimeCapabilities; // streaming / interrupt / resume / approval / tools / multi_session
}
```

- 传输可以是 stdio JSON-RPC、HTTP+SSE、WebSocket，v0 也可以是进程内接口；关键是语义。
- **ACP** = 宿主/IDE ↔ agent，是 adapter 之一，不是系统主协议；ACP 本身是 session-oriented，不规定一 session 一进程。
- **MCP** = agent ↔ 工具；**A2A** = agent ↔ agent 任务（外部边缘）。
- 每个 adapter 要通过 conformance：建 session、收消息、流式回复、中断、恢复、审批、健康检查。

### 10.3 Runtime 生命周期与 Supervisor

- **Supervisor**（基础设施，不是 agent）：开机自启、读 agent registry、启动 gateway、健康检查、崩溃重启、按需启动 runtime、空闲休眠。
- **启动模式**：懒启动（冷 thread）/ 预热（活跃 thread，10–30 分钟）/ 常驻（服务器）。
- **不要按消息启停**；只在空闲时睡，不在 turn 中间杀。
- **恢复流程**：连 Matrix → since token 补课 → 读 session 表 → `ensureSession`（resume 或重建）→ event_id/txn_id 去重 → 处理。
- **保证**：至少一次投递 + 幂等消费；不保证跨外部工具的 exactly-once。
- Windows：计划任务 / NSSM / Docker restart policy；开发期用启动脚本。

### 10.4 已确认的接入顺序

✅ 先 Claude Code 跑通；再加 Codex → OpenClaw → dsh → Hermes → 自研。
✅ Hermes Agent 是 Nous Research 的开源 agent（不是模型），有持久记忆、消息网关、子 agent、沙箱；作为 participant/adapter，不当 Hub。
✅ OpenClaw 是 participant/adapter，不是 Hub。

### 10.5 本地资源与部署

| 组件 | 内存粗估 |
|---|---|
| Matrix：Conduit | ~50–150MB |
| Matrix：Synapse + Postgres | ~0.5–1GB |
| Element Web（静态） | ~20–50MB |
| Gateway/Supervisor（一个进程） | ~100–250MB |
| 2–3 个 runtime | ~0.5–1.5GB |
| **合计** | **约 2–3GB（Conduit）/ 3–4GB（Synapse）** |

- 16GB 内存足够；Docker/WSL2 额外 1–2GB。
- 省资源：Conduit、一个 gateway、runtime 懒启动/空闲睡、SQLite、v0 不用 per-agent 容器、worktree 放 D 盘。
- 第一个协议 spike 不需要 Matrix/Docker：Node + Claude CLI + 假总线即可。
- H1：本机先搞；办公机后面 `git pull` 复现；环境差异与清单见 `10-dev-setup.md`。

## 11. 自主群聊 / 发言规则（v0 核心）

> **自由发言 + 单写者串行 + 静默收敛 + 显式共识/升级**

### 11.1 投递 vs 唤醒

- **投递**：房间成员都收到所有消息；`@` 只是注意力/优先级信号，不是只发给被 @ 的人。
- **唤醒**：不是每条消息都叫醒每个 agent。`wake_policy`：`all` / `mention_or_reply`（推荐）/ `mention_only` / `digest`。
- 没被唤醒的 agent 下次醒来仍能看到完整房间历史。
- Envelope 字段：`mentions`、`direct_mention`、`reply_to`、`attention`（direct_mention / reply / room_mention / ambient）、`intent`、`recent_messages`。

### 11.2 自由发言

- agent 不需要被 @ 才能说话；可以根据自己的判断主动发言（volunteer）。
- 可以旁听、沉默、反对、私聊。
- `speak_mode` 可配置：`mentioned_only` / `volunteer`（v0 默认，受频率/成本限制）/ `open`。

### 11.3 单写者串行（不是轮流）

- 每个 thread 一个 floor（写锁/发言权）；持有者写，其他人排队。
- 为什么：一轮可能跑几十秒到几分钟；并发写同一 thread 会读到旧上下文、输出交错、重复回复。串行是**技术写锁**，不是社会等级。
- 谁获得 floor：被 @/回复者 → task owner → 主动举手（volunteer）→ 开放讨论时公平轮转。
- 持有者可以 `pass`（无话，不消耗 turn）、`handoff`（交给下一个）、`done`（结束）。
- 不同 thread 可以并行（不同 session）；不是全系统排队。

### 11.4 静默收敛（自然结束）

| 状态 | 含义 | 消耗算力 |
|---|---|---|
| `idle` | 没有当前任务，可用/在听 | 否 |
| `waiting` | 有任务，但卡在外部输入（工具/审批/floor/人类/网络） | 否 |
| `thinking` | 模型正在生成 | 是 |
| `working` | 工具/命令正在跑 | 是（工具侧） |
| `done` | 当前任务完成，仍在房间 | 否 |
| `pass` | 这一轮选择不发言 | 否 |
| `error` | 失败，需要处理 | 否（但需告警） |

- 进入 `quiescent` 需要同时满足：无 `thinking/working`；无未完成 task；无未回答 question；无待审批；最近实质消息后安静 `quiet_window`（30–60s）；所有活跃 agent 已看最新消息或 `pass`。
- **事件驱动 + 定时器**：状态变化/最后实质消息时设一个 quiet 定时器；到点检查一次；低频心跳（如 5s）兜底。不轮询每个 agent。
- 进入 quiescent 后 runtime 可睡；新消息唤醒。
- 有未完成工作但长时间无进展：提醒 owner 或 `ask_human`。
- 硬上限只做安全网，动态设置（`base + per_agent * 人数` 或 token 预算）。

### 11.5 显式共识

| 规则 | 形式 | 适合 |
|---|---|---|
| Lazy consensus（v0 默认） | 提案发出后 T 时间内无人 `object`，且有 quorum 看过 → 通过 | 低风险、日常 |
| Unanimous | 所有活跃 agent `agree`，无 `object` | 高风险/重要 |
| Majority | >50% 活跃 agent `agree`，达到 quorum | 人多、意见分散 |
| Owner decides | 议题/task owner 听完反对后拍板 | 有明确负责人 |
| Escalation | 到 deadline 仍无共识 → @ 相关人类（升级链），附立场摘要 | 兜底 |

- 网关只计数/记录显式信号，不判断内容；无 LLM “自称共识”。
- 升级链见 8.3。
- v0：lazy consensus + 人类升级；多数票以后再加。

### 11.6 发言规则的已知漏洞与处理

| 漏洞 | 处理 |
|---|---|
| 每个 agent 回复每条消息 → 烧钱/刷屏 | speak_mode、wake_policy、频率限制、`pass` 不计 turn |
| 并发写同一 thread → 旧上下文/交错 | 单写者 floor + transcript 版本 |
| 礼貌/同意循环 | 无新信息检测、重复 hash、静默窗口 |
| 一个 agent 霸占 | 公平队列、每 agent 配额/冷却 |
| 安静 agent 不说话 | 决策点 roll call；允许 volunteer，不强制 |
| 人类一说话就打断 | 高优先级但不自动 preempt；`!interrupt` 才强制；内容可反驳 |
| 人类跑题 | agent 可忽略/`pass`/反驳；控制命令必须执行 |
| 跨 thread 丢失 | inbox + 持久队列 + ack；只有当前 thread steer |
| 决议含糊 | `decision` 带规则/决策人/参与者；无记录不算决议 |
| 私聊搞小动作 | DM 允许但 Admin 可见；决议回房间 |
| 崩溃重复 | event_id/txn_id 幂等 |
| 静默误判/失效 | 跟踪 working/waiting；重复检测 + quiet window + 动态上限 |
| 人类不在场 | 超时策略；高风险默认拒绝/等待 |
| prompt injection | 消息不可信；工具最小权限；危险操作审批 |
| 长工具调用饿死 floor | 最大 turn 时长/检查点；thread 间并行 |

### 11.7 消息意图（intent）

`chat` / `proposal` / `question` / `answer` / `decision` / `task` / `status` / `done` / `handoff` / `ask_human` / `agree` / `object` / `abstain` / `pass`。

## 12. 数据平台 / 管理界面（v0 Must，最小版）

- **看**：agent 清单/状态/预算；房间与成员；实时事件流（消息、工具调用、审批、成本、floor、生命周期）；成本报表；审计筛选/导出/回放。
- **控**：创建/配置/禁用/删除 agent；暂停/杀死/重启；预算/allowlist/trust/房间策略；批准/拒绝 merge/deploy/delete/付款；全局 kill switch。
- **v0 形态**：网页（PWA 可选）；一个产品外壳，两个区域——聊天（Element/自研）+ 控制台/数据台；v0 可以先用 Element 聊天 + 本地 Web dashboard，后面合成 Tauri 壳。
- 数据源：Matrix 历史 + gateway 事件日志 + policy DB；统一事件 schema。

## 13. 核心用户旅程（v0 必须跑通）

1. Admin 创建 `@claude-dev`、`@codex-review`、`@claude-pm` 和项目房间。
2. 人类发需求；agents 在群里自由讨论，形成 `decision`，拆成 `task`。
3. Claude 在自己的 worktree 实现；Codex 在另一个 worktree review；人类在 thread 插话/steer。
4. 人类在 Element 看到消息；在数据平台看到工具调用、成本、floor、审批。
5. 人类 `!approve` 批准合并；agent 发 `done` + artifact。
6. kill 任意 gateway，重启后不重复消费；超预算/回合上限自动停。

## 14. MoSCoW

**Must（v0）**

- M1 身份与生命周期：创建/配置/禁用/删除；独立 MXID；agent home；多实例
- M2 DM + 群 + @mention + thread + reply + 历史
- M3 Gateway + Claude adapter + 1 个脚本 peer（先证明拓扑）
- M4 自主群聊：投递/唤醒分离、intent、自由发言、单写者 floor、静默收敛、共识/升级、task
- M5 数据平台最小版：全量可见 + 暂停/杀死 + 审批 + 成本/工具日志
- M6 独立 worktree + 人类批准合并
- M7 重启不重复、预算硬停、kill switch

**Should**

- S1 Codex adapter（跨厂商 review）
- S2 OpenClaw / dsh / Hermes adapter
- S3 Directory / Agent Card 搜索 + 动态议程角色
- S4 Cron/webhook 触发（主动巡逻）
- S5 更完整的审计/回放/导出
- S6 通知（桌面/飞书）

**Could**

- C1 human-human E2E
- C2 多租户 / 公开注册
- C3 A2A / 外部 agent
- C4 移动端 / 飞书桥
- C5 计费/用量报表

**Won't（v0）**

- 新的 agent 框架/模型/推理网关
- 中心化调度器 / main 管家 / subagent 生命周期
- 微信/QQ 级客户端
- 自建 IM 协议
- federation
- 完整商业控制台
- per-agent 容器（先用 worktree + 独立进程；容器以后）

## 15. MVP 验收与 kill criterion

**Demo**：1 human + 2–3 agents；群里自由讨论一个小需求 → 形成决议 → 分工 → 各自 worktree 执行 → review → 人类批准合并；全程可在 Element + 数据平台看到。

必须同时满足：

1. 人类 DM/@ agent → 回复；不 @ 时可按 speak_mode 主动发言或沉默。
2. Agent A 主动 DM Agent B → B 回复；有 allowlist/审批记录。
3. 群聊能形成一条 `decision` 和至少两条 `task`；没有 main 分发。
4. Admin 在数据平台看到全部消息、工具调用、成本、floor、审批。
5. kill gateway → 重启 → 不重复回复/消费。
6. 互 @ / 讨论到动态上限 → 自动停，要求人类决定。
7. 超预算 → 暂停 + 通知。
8. 两个 agent 各自 worktree，互不污染；合并经人类 `!approve`。
9. 静默收敛：所有 agent `pass`/`done` 且无未完成工作 → thread 休眠；新消息唤醒。

**Kill criterion**：同一任务对比“单 Claude + subagent”；如果 IM 版在完成质量、token 成本、人类干预次数上没有明显优势，停止扩张，转为观测/治理层或个人工具。

## 16. 假设与约束

- ✅ A–D/F/E/G 已确认；H1 本机先搞；H2 已装 `spec-driven-development`（addyosmani）。
- ✅ v0 底座：Matrix + Element（单 homeserver；先用子集：普通账号、房间、消息、历史；不用 AppService/E2E/federation）。
- 本机当前**没有 Docker Desktop / 可用 WSL 发行版**；C 盘剩 25GB、D 盘 321GB、16GB 内存。上 Matrix 时再装 Docker+WSL2（数据放 D）/ 用办公机 / 小 VPS。
- 本机只有 Claude Code + OpenClaw；**Codex/dsh 未安装**，需本机装或用办公机；Hermes 未装。
- 单开发者；【待确认】每周投入时间、每月 API 预算上限（你说不够会停，暂不设硬数字）。
- Agent 是半可信：防 prompt injection/循环/超预算；不防“持有 Matrix token 的恶意 agent”（v0）。
- 个人工具标准，不承诺 99.9% 可用性；审计保留期【待确认】。
- 办公机 Win11 Pro 常驻，有 OpenClaw + 飞书 + ACP 的 claude/codex；可作为第二节点。环境差异见 `10-dev-setup.md`。

### 16.1 需求完整性待补

运营（备份/恢复、RPO/RTO、日志保留、监控、事故响应、升级迁移）；合规/隐私（保留期、删除/擦除、审计访问、外部 agent 数据边界、模型供应商条款）；安全（威胁模型、prompt injection、凭据、沙箱）；可用性（目标、降级、离线、消息语义）；成本（预算、超预算、归集）；体验（首次使用、创建 agent、错误、可访问性、i18n）；验收（每个 Must 的 Given/When/Then）；变更（版本、迁移、兼容、废弃）。

## 17. 待确认问题

- ✅ **H2. Requirements skill**：已装 `addyosmani/agent-skills@spec-driven-development`（78.2K，codeload 手动装）；`jwynia/agent-skills@requirements-analysis`（2.3K）可选补充。
- **DM 非 owner human**：允许但限频，还是需要 Admin 批准？
- **审计保留期**：默认 90 天还是手动清理？
- **`can_invite` 默认值**：v0 用 `allowlist` 还是 `none`？
- **动态议程角色/Directory**：v0 只做静态 roles + 房间成员，够吗？
