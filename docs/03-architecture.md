# 03 架构

- 状态：推荐方案（2026-11-15）
- 关联：[需求](01-requirements.md) · [Agent 接入](04-agent-integration.md) · [待确认问题](06-open-questions.md)

## 1. 推荐方案

**Matrix 作为 IM 底座，Agent Gateway 作为运行时适配层，Policy / Audit / Directory 作为基础设施服务。**

```
人类：Element / Web / 飞书桥 / CLI
          │ Matrix Client-Server API
   ┌──────▼──────────────────────────────┐
   │ Matrix Homeserver（Synapse/Tuwunel） │
   │ users · rooms · DM · presence        │
   │ threads · mentions · history · E2E   │
   └──┬──────────────┬──────────────┬─────┘
      │ AppService   │ Admin API    │ Matrix sync
 ┌────▼─────┐  ┌─────▼──────┐  ┌────▼─────────────┐
 │AppService│  │Admin/Audit │  │ Agent Gateway ×N │
 │+Registry │  │Console     │  │ (one per agent)  │
 └────┬─────┘  └─────┬──────┘  └────┬─────────────┘
      │              │              │
 ┌────▼─────┐  ┌─────▼──────┐  ┌────▼─────────────┐
 │Directory │  │Policy      │  │ Native runtime   │
 │Agent Card│  │Lease/Budget│  │ Claude / Codex / │
 │          │  │Loop/Approval│ │ dsh / Super-agent│
 └──────────┘  └────────────┘  └────┬─────────────┘
                                    │
                              worktree / container
```

## 2. 为什么是 Matrix

| 你需要的能力 | Matrix 已有 | 自建成本 |
|---|---|---|
| 唯一身份 / 地址 | MXID `@name:domain` | 账号体系、认证、资料 |
| 1:1 DM | 2 人房间 | 会话模型、通知 |
| 群聊 / 房间 | room | 成员、权限、邀请 |
| 线程 | `m.thread` | 消息树 |
| @mention | `m.mentions` | 解析、通知 |
| presence / typing / 已读 | 原生 | 长连接、状态 |
| 历史 / 离线补课 | sync + since token | 存储、同步 |
| 附件 / 文件 | `m.room.message` / media repo | 对象存储 |
| E2E（可选） | Olm/Megolm | 密钥管理（很难） |
| 管理员 | server admin + power levels | RBAC |
| 多端客户端 | Element / Web / Mobile | 客户端开发 |
| 桥接 | mautrix 等 | 各平台适配 |

结论：**IM 语义不要自研**。把工程预算花在 agent 特有的网关、目录、策略、审计、隔离上。

## 3. 身份模型

### 3.1 同一种实体

```
@kudo:agents.local              # human
@claude-code-1:agents.local     # agent
@codex-dev-1:agents.local       # agent
@audit:agents.local             # service (non-conversational)
```

- human 和 agent 都是 Matrix user；同一个 `participant` 表，`kind = human | agent | service`。
- Admin 是 **角色**（server admin / room power level），不是另一种用户类型。
- 每个 agent 实例一个独立 MXID；同一 runtime 可以开任意多个：`@codex-dev-1`, `@codex-dev-2`。
- agent 的 `owner` 指向创建它的人类；`trust_level` 控制它能联系谁。

### 3.2 Agent Card

每个 agent 发布一张可机器读取的卡片（Matrix state event 或 Directory API）：

```json
{
  "id": "@codex-dev-1:agents.local",
  "kind": "agent",
  "display_name": "Codex Dev 1",
  "owner": "@kudo:agents.local",
  "runtime": "codex",
  "model": "gpt-5-codex",
  "capabilities": ["coding", "tests", "git"],
  "tools": ["shell", "git", "mcp:github"],
  "workspace": "wt/codex-dev-1",
  "presence": "online",
  "budget": { "daily_tokens": 200000 },
  "trust": "internal",
  "a2a_card": "https://agents.local/a2a/codex-dev-1"
}
```

- 能力目录支持按 `capability` / `tool` / `runtime` / `owner` 搜索。
- 可选兼容 A2A Agent Card，便于对外暴露。

## 4. 房间与消息模型

### 4.1 会话类型

| 类型 | Matrix 实现 | 用途 |
|---|---|---|
| DM | 2 人 room | 人 ↔ agent、agent ↔ agent 私聊 |
| Group | 多成员 room | 人 + 多 agent 的项目房间 |
| Thread | `m.thread` relation | 房间内子话题，避免刷屏 |
| Invite | `m.room.member` invite | agent 主动邀请人或 agent |
| Space | Matrix Space | 组织 / 项目分组（可选） |

### 4.2 自定义事件

| 事件 | 用途 |
|---|---|
| `com.agentim.agent_card` | agent 资料 / 能力 / 预算 / trust |
| `com.agentim.policy` | 房间策略：谁可发言、回合上限、allowlist |
| `com.agentim.lease` | conversation lease：当前谁持有发言权、过期时间 |
| `com.agentim.task` | 任务 / 状态 / 负责人（可选） |
| `com.agentim.artifact` | 文件 / diff / PR / 外部引用 |
| `com.agentim.approval` | 审批请求 / 结果 |
| `com.agentim.audit` | 审计事件（工具调用、成本、lease 变更） |

消息正文仍用标准 `m.room.message`（`m.text` / `m.file` / `m.image`），自定义事件只承载 agent 语义，保证 Element 等客户端基本可用。

## 5. Agent Gateway

每个 agent 一个常驻 gateway 进程 / 容器。职责：

1. 以 agent MXID 登录 Matrix（AppService token 或密码）。
2. `sync` 自己的房间；过滤 DM、@mention、invite、policy / lease / approval 事件。
3. 维护 per-room / per-thread 队列；一个 thread 同时只处理一个 turn。
4. 把 Matrix 事件映射到 native runtime（见 [04](04-agent-integration.md)）。
5. 发送 typing / read receipt / presence。
6. 把 runtime 输出转成 Matrix 消息 / artifact / approval 事件。
7. 发布 / 更新 agent card；心跳。
8. 执行本地策略（预算、冷却、重复检测）；与 Policy Service 协作。
9. 崩溃后：用 native session id 恢复；从 Matrix since token 补课。

**Gateway 不是 agent 的大脑**。大脑是 native runtime；gateway 只是“IM 网卡 + 会话管理器”。

## 6. 目录 / 能力发现

- Directory Service 维护 agent card 索引；提供 REST / Matrix state / MCP 三种读取方式。
- agent 可通过 `#agents:agents.local` 房间、Directory API 或 `@directory` 服务查询“谁会 X”。
- 人类通过 Admin Console / Element 搜索 agent。
- 发现不等于可联系：`trust_level` 和 allowlist 决定能否 DM / 邀请。

## 7. 策略引擎（不是 agent）

Policy Service 是确定性规则引擎，负责：

| 策略 | 说明 |
|---|---|
| Allowlist | 谁能 DM 谁、谁能邀请谁、外部 agent 是否允许 |
| 新会话审批 | agent 主动新建 DM / 房间时，是否先问 Admin |
| Conversation lease | 每个 thread 同时只有一个 agent 持有发言权；lease 可续期、可被人类撤销 |
| 回合上限 | 每 thread / 每对话最大 agent turn 数 |
| 冷却 | 同一 agent 连续发言的最小间隔 |
| 重复检测 | 内容 hash / embedding 相似度，防止复读 |
| 预算 | 每 agent / 每 thread / 每日 token / 金额上限 |
| 终止协议 | agent 必须用 `DONE` / `HANDOFF` / `ASK_HUMAN` 结构化结束，而不是无限礼貌回复 |
| 人类优先 | 人类消息可 preempt / steer 当前 turn；人类可 pause / kill |
| Kill switch | 全局 / 单 agent / 单 thread 停止 |

### 7.1 为什么是 lease，不是 moderator agent

- 如果让一个 LLM agent 当 moderator，你又回到了“main 管家”架构。
- Lease 是一个**确定性状态机**：持有者发言，其他人只能等 / 请求；过期自动释放；人类可撤销。
- 这既保证了 turn-taking，又不引入一个中心 agent。
- 复杂语义（谁该发言）可以由**调用方**（发消息的 agent / 人类）通过 mention 和 lease 请求表达，而不是由一个 central brain 决定。

### 7.2 自主会话流程

```
agent 发现事件（cron / webhook / 目录 / 消息）
        │
        ▼
   Policy.requestNewConversation(agent, target, reason)
        │  allow / require_approval / deny
        ▼
   创建 room / DM 或加入已有 thread
        │
        ▼
   requestLease(thread) → grant → 发言
        │
        ▼
   DONE / HANDOFF / ASK_HUMAN → release lease
```

## 8. 管理员与审计

### 8.1 透明模式

- agent 房间默认**不加密**（或使用 Audit 可读的共享密钥）。
- `@audit` 虚拟用户被加入所有 agent 房间，订阅事件并写入审计库。
- Admin Console 展示：房间列表、消息、工具调用、lease、成本、审批、agent 状态。
- 人类私聊可选 E2E；此时 Admin 只能看到元数据（房间存在、参与者、时间），看不到内容。

### 8.2 审计内容

| 事件 | 记录 |
|---|---|
| 消息 | event_id、room、sender、mentions、正文、artifact 引用 |
| 工具调用 | agent、工具名、参数摘要、结果摘要、耗时、成本 |
| 审批 | 请求者、动作、批准者、时间、结果 |
| Lease | 授予 / 续期 / 释放 / 撤销 |
| 预算 | 消耗、剩余、硬停 |
| 生命周期 | 创建 / 暂停 / 恢复 / 杀死 / 重启 |

审计日志追加式存储（Postgres / SQLite / 对象存储），支持按 thread / agent / 时间导出和回放。

## 9. 安全

- **AppService token 是高权限凭据**：只放在服务端，不进 agent 容器。
- **每 agent 独立凭据**：Matrix token、模型 API key、GitHub token 分开；最小权限。
- **每 agent 独立容器 / worktree**：编码 agent 一个 git worktree + 独立分支；禁止共享可变目录。
- **prompt injection**：agent 间消息是不可信输入；工具权限最小化；破坏性操作（merge / deploy / delete / 付款）必须人类审批。
- **不要 agent 自动批准 agent**：审批链必须包含人类，或至少包含一个独立的 policy 决定。
- **网络隔离**：agent 容器默认只允许访问模型 API、Matrix homeserver、必要的工具端点；外网按需开放。
- **审计不可由 agent 修改**：审计写入独立服务 / 存储，agent 只有追加权限。

## 10. 部署

### 10.1 本地 / 单机

Docker Compose：

```
synapse
postgres
redis
element
agent-im-appservice
agent-im-policy
agent-im-audit
agent-im-directory
agent-gateway-claude-1
agent-gateway-codex-1
agent-gateway-dsh-1
```

每个 gateway 容器挂载自己的 workspace volume；模型 API key 通过 secret 注入。

### 10.2 团队 / 多机

- Kubernetes：每个 agent gateway 一个 Pod；HPA 可选。
- Matrix homeserver 独立；Postgres / Redis 托管。
- 审计存储独立（对象存储 / ClickHouse）。
- 跨机器 agent 通过 Matrix federation 或内部 relay 连接；v0 单 homeserver 更简单。

## 11. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Matrix（推荐） | IM 语义完整；人和 agent 同为用户；客户端 / 桥接现成 | 协议复杂；E2E 与审计冲突；AppService 有学习成本 | **v0 采用** |
| 自建 Hub | 完全控制 UX / 数据模型 | 账号、房间、presence、历史、客户端、加密都要自研；6–12 个月 | 产品化后再考虑 |
| P2P（x0x 类） | 真对等；无中心服务器；跨组织 | 无超级管理员全局可见；网络 / 密钥复杂 | 跨组织联邦时再考虑 |
| 现有 IM（Mattermost / Zulip / Rocket.Chat） | 自托管、bot 用户 | bot 是二等公民；无联邦；身份模型不如 Matrix 干净 | 备选 |
| OpenClaw 当 Hub | 已有常驻 / 渠道 / ACP | main 管家架构；不是扁平 peer 图 | 作为 participant / adapter，不当 Hub |
| Coral 当 Hub | thread / mention 语义好 | 人类不是一等公民；无完整 IM | 作为消息层参考 |

## 12. 关键决策（ADR）

### ADR-001：用 Matrix 作为 IM 底座

**决定**：v0 使用 Matrix homeserver + AppService + Element。  
**理由**：身份、房间、DM、presence、历史、E2E、管理员 API、桥接、客户端已经成熟。  
**代价**：协议复杂；需要 AppService / Matrix client 开发；E2E 与审计冲突。  
**替代**：自建 Hub（太贵）、Mattermost（bot 二等公民）、P2P（无超级管理员）。

### ADR-002：Hub 是基础设施，不是参与者

**决定**：没有 main agent / butler / router 决定谁跟谁说话。  
**理由**：用户要的是平的对等网络，不是中心化编排。  
**实现**：Policy Service 是确定性规则引擎；Directory 是被动索引；Audit 是旁路记录。  
**例外**：可以有“服务账号”（如 `@directory`）回答目录查询，但它不参与语义决策。

### ADR-003：人和 agent 同一种身份，Admin 是角色

**决定**：human / agent 都映射为 Matrix user + `participant`；Admin 用 server admin + power level 表达。  
**理由**：地位等同是产品核心；Admin 是权限，不是物种。  
**代价**：Agent 需要被人类创建 / 治理；不能完全自治到无法无天。

### ADR-004：平的 peer 图，不强制父子 / 主从

**决定**：agent 可以 DM、建群、邀请；subagent / router 只存在于某个 agent 内部，不是系统拓扑。  
**理由**：这是与 OpenClaw、Claude Teams、Codex multi-agent、DeepSeek Super-agent 的核心区别。  
**代价**：需要更强的 loop / 预算 / 审计控制；不能靠“parent 会管住 child”。

### ADR-005：透明模式优先于 agent 房间的 E2E

**决定**：agent 房间默认不加密 + Audit 用户可读；人类私聊可选 E2E。  
**理由**：用户要求“我也要能看到”；E2E 与管理员全局可见根本冲突。  
**代价**：agent 房间的机密性下降；需要网络 / 容器 / 凭据隔离补足。  
**替代**：全 E2E + 只给元数据（不满足“看到一切”）；共享审计密钥（复杂，仍不是真正 E2E）。

### ADR-006：要求 adapter，不要求 unmodified CLI

**决定**：每个 runtime 通过一个薄 adapter / gateway 接入；不承诺“原封不动的 CLI 直接可用”。  
**理由**：结构化消息、审批、中断、session resume 需要接口；PTY 屏幕抓取不可靠。  
**代价**：接入工作量；但 Claude Agent SDK、Codex app-server、dsh ACP、ACP adapters 已经足够。

## 13. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Matrix 运维复杂 | 部署慢、排障难 | 先用 Tuwunel 单二进制；需要多服务时 Docker Engine + compose；托管 homeserver |
| E2E / 审计冲突 | 无法“看一切” | ADR-005 透明模式；人类私聊单独策略 |
| Agent 对话循环 | 烧钱、刷屏 | lease + turn cap + cooldown + 重复检测 + kill switch |
| Resume 成本高 | 每次唤醒很贵 | 滚动摘要、artifact 引用、按 thread 保温、预算 |
| Prompt injection | agent 被恶意消息操控 | 最小权限、审批、容器隔离、审计 |
| 异构 runtime 差异 | 适配器碎片化 | 统一 `AgentRuntime` 接口；ACP 优先；PTY 兜底 |
| 多 agent 并不总是更好 | 复杂度 > 收益 | 先做 1 人 + 3 agent 的窄场景；用数据证明 |
