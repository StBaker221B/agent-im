# 02 现有项目调研

- 调研日期：2026-11-15
- 方法：GitHub API / `skills.sh` / WebSearch；星数为当日近似值，会变化。
- 完整链接见 [research/sources.md](../research/sources.md)。

## 1. 结论先行

**有大量“agent 通信 / agent 社交 / agent IM”项目，但没有一个同时满足你的全部条件：**

1. 人与 agent 身份对等，都是用户；
2. 平的 peer 图，没有 main / router / 主从；
3. agent 可以自主发起会话；
4. 人类管理员全局可见；
5. 异构 agent（Claude Code / Codex / dsh / Super-agent）都能常驻接入。

最接近的不是某个“agent 框架”，而是三条线：

- **Matrix 生态**：身份、房间、DM、presence、历史、管理员和客户端已经解决；`MindRoom` 已经在做“agent 作为 Matrix 用户”。缺的是你的扁平拓扑 + 透明审计 + 异构网关。
- **字面意义上的 Agent IM**：`LinklyAI/agent-im`、AgentIM（Railway）已经有 rooms / @mention / 多 agent；但多数是 demo 或带 orchestrator，缺生产级身份、策略、审计。
- **agent 消息层**：`masumi-agent-messenger`、`x0x`、`Coral Protocol` 解决了 agent ↔ agent 的 inbox / thread / mention；但人类不是一等公民，或没有超级管理员。

## 2. 项目清单

### 2.1 Matrix 生态（最接近底座）

| 项目 | 是什么 | 对你的价值 | 差距 |
|---|---|---|---|
| [Matrix](https://matrix.org/) / [Spec](https://spec.matrix.org/) | 开放、联邦的 IM 协议；用户、房间、DM、presence、已读、E2E、管理员 API、桥接 | 人和 agent 天然是同一种用户；房间历史 / 离线补课 / 多端 | 不是 agent 产品；需要 AppService + 网关 + 策略层 |
| [mindroom-ai/mindroom](https://github.com/mindroom-ai/mindroom)（370★） | 开源的“AI agents in Matrix rooms”；每个 agent / team / router 有独立 Matrix 用户；支持 appservice、E2EE、mention、thread、dashboard | 直接验证了“agent 作为 Matrix 用户”的可行性；有 appservice 经验 | 有 team / router 概念，拓扑偏中心化；不是你的扁平 peer 图 |
| [agentscope-ai/agentteams](https://github.com/agentscope-ai/agentteams) | Matrix AppService 集成设计：manager / worker / human 账号、命名空间、无密码登录 | 参考 AppService 虚拟用户和权限模型 | manager / worker 是层级；不是产品 |
| Chums Chat | Matrix 客户端，AI agents 作为参与者加入聊天，支持多 agent、E2EE、自托管 | UX 参考 | 是客户端 / 生态，不是基础设施 |

### 2.2 字面意义上的 Agent IM

| 项目 | 是什么 | 对你的价值 | 差距 |
|---|---|---|---|
| [LinklyAI/agent-im](https://github.com/LinklyAI/agent-im)（35★，MIT） | 极简（约 500 行）“IM, but for agents”；MCP + HTTP、threaded rooms、Web UI、Cloudflare Workers + D1 | 最小可读实现；适合学习房间 / thread / MCP 接入 | 太薄：无 admin / 策略 / 身份治理 / 多租户 |
| AgentIM（[Railway 部署页](https://railway.com/deploy/agentim)） | “Slack for AI coding agents”：Claude Code / Codex CLI / Gemini CLI、rooms、@mention、tasks、PWA、WebSocket CLI、PostgreSQL + Redis | 最接近“给 coding agent 用的 IM”的产品形态 | 中心化 + 偏任务编排；未见完整的“人对等 + 管理员透明”模型 |
| [rikey123/AgentHub](https://github.com/rikey123/AgentHub)（8★） | IM 风格多 agent hub：solo / assisted / team 模式，`@Agent` 派发，有 orchestrator | 群聊 / @ 派发的交互参考 | 有 orchestrator，层级明显 |
| [codecast agent channels](https://github.com/codecast-sh/codecast/blob/a7b972dac91d4a28295090f58999e005775abdd7/docs/architecture/agent-channels.md) | 设计文档：mention envelope、wake / delivery caps、roles、sessions in rooms | 回合 / 唤醒 / 投递上限的工程参考 | 不是独立产品 |

### 2.3 Agent 消息 / 通信层

| 项目 | 是什么 | 对你的价值 | 差距 |
|---|---|---|---|
| [masumi-network/masumi-agent-messenger](https://github.com/masumi-network/masumi-agent-messenger)（12★，MIT） | 永久 agent 地址、E2E 私聊、签名频道、thread、CLI / TUI / Web inbox、human-in-the-loop、SpacetimeDB | 最接近“agent 的持久 inbox”；framework-agnostic；可自托管 | 消息 / inbox 层，不是完整 IM（presence、群管理、管理员、runtime 网关） |
| [saorsa-labs/x0x](https://github.com/saorsa-labs/x0x)（22★） | P2P gossip 网络：DM、Spaces、MLS 群、presence / FOAF、contacts / trust、CRDT task board、本地 REST/WS | 真正的对等 / 去中心化路线；适合跨组织 | 没有中心超级管理员；与“Admin 看一切”冲突；复杂度高 |
| [Coral Protocol](https://github.com/Coral-Protocol/coral-server) / [Threads 文档](https://docs.coralos.ai/concepts/threads) | Coral Server + MCP 工具：thread、participants、@mention、`wait_for_mention`、Studio、Puppet API | 最像“agent 的 Slack”的 thread 语义；人类可通过 Puppet 加入 | agent-first；人类不是一等用户；无完整 IM / 管理员 |
| [A2A](https://a2a-protocol.org/)（v1.0，Linux Foundation / AAIF） | agent ↔ agent 的任务协议；Agent Card、task、streaming；150+ 组织 | 跨厂商 / 跨组织边缘互通 | 不是 presence / IM；生态仍在从 0.3 迁移；消息不签名 |
| [ACP](https://agentclientprotocol.com/) | 宿主 / IDE ↔ agent 的协议；Zed 等在用 | “任意 agent 独自接入”的适配器标准 | 不是 agent ↔ agent；需要 Hub 仍然存在 |
| [MCP](https://modelcontextprotocol.io/) | agent ↔ 工具 / 数据 | 工具接入 | 不是消息总线 |

### 2.4 Agent 运行时 / 编排

| 项目 | 是什么 | 对你的价值 | 差距 |
|---|---|---|---|
| [OpenClaw](https://docs.openclaw.ai/tools/acp-agents) | 常驻 Gateway + 多渠道 + agents + sessions + ACP；`tools.agentToAgent` + `sessions_send`（默认开，5 ping-pong） | 你已经有的底座；ACP 可接 Claude Code / Codex / dsh；飞书人类入口 | main 管家 / 层级；不是扁平 peer 图；无 worktree / 审批 / 成本面板 |
| [Letta](https://docs.letta.com/configuration/subagents) | 持久身份 + 记忆的 stateful agents；`SendAgentMessage`（云版）；subagents | 持久身份 / 记忆 / agent 间发消息 | 偏有状态助手；不是 IM；`SendAgentMessage` 云版限制 |
| [Claude Code Agent Teams](https://code.claude.com/docs/zh-CN/agent-teams) | lead + teammates；`SendMessage` / `ListAgents`；跨会话；共享 task list | 原生多 session 互通；可作为 adapter 经验 | lead 层级；仅 Claude；实验性 |
| [Codex app-server](https://www.infoq.com/news/2026/02/opanai-codex-app-server/) | Thread / Turn / Item；resume / fork；审批；JSON-RPC | 最适合嵌入常驻系统的 Codex 路径 | 仅 Codex；没有 IM / 人类 UI |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（281k★，MIT） | “Everything is a plugin”；Web UI / headless / Python SDK / ACP | dsh 接入路径；插件化 | 是 harness，不是 IM |
| [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（23k★，MIT） | Router + Workers；持久实体；IM / group / email / GitHub 渠道；主动行为 | 可作为“一个超级 agent 用户”接入；渠道 / 主动触发参考 | Router + Workers 是内部层级；研究原型 |
| [camel-ai/oasis](https://github.com/camel-ai/oasis)（5.4k★） | 百万 agent 的社会模拟（社交网络） | 社交图 / 大规模 turn-taking 研究参考 | 模拟，不是真实 agent IM |

## 3. 最接近的组合

| 目标 | 最接近的现成件 | 还差什么 |
|---|---|---|
| 人与 agent 同为用户 | Matrix / MindRoom | 扁平拓扑、管理员透明、异构网关 |
| 字面 Agent IM | LinklyAI/agent-im、AgentIM | 身份治理、策略、审计、生产级 runtime |
| Agent 间持久 inbox | masumi-agent-messenger | 群 / presence / admin / runtime 网关 |
| 真 P2P | x0x | 与超级管理员可见性冲突 |
| Agent thread / mention | Coral Protocol | 人类一等公民、完整 IM |
| 常驻多 agent | OpenClaw、Letta | 扁平 peer 图、管理员透明 |
| 异构 agent 接入 | ACP / A2A / Codex app-server / dsh ACP | 需要 Hub 把消息、身份、策略串起来 |

## 4. 你的差异化

现有项目大多落在两个极端：

- **Agent 框架**：AutoGen / CrewAI / Claude Teams / Codex multi-agent——有编排，但没有“用户身份 / IM / 管理员”。
- **Agent 消息层**：masumi / x0x / Coral / A2A——有消息，但没有“完整 IM + 人类对等 + 超级管理员”。

你的位置在中间：

> **一个平的、身份对等的 agent IM，Hub 只做基础设施，agent 自主发起会话，人类 Admin 全局可见，异构 runtime 通过 adapter 接入。**

这四个词是差异化的核心：**flat / equal / transparent / heterogeneous**。

## 5. 经验教训

1. **不要重造 IM**。Matrix 已经把身份、房间、DM、presence、已读、线程、mention、历史、附件、E2E、管理员 API、桥接和客户端做完了。你重造至少多花 6–12 个月。
2. **Agent 特有的价值在网关、目录、策略、审计、工作区隔离**，不在消息传输。
3. **大多数“Agent IM”会不自觉 reintroduce 一个 router / manager**；这正是你要避免的。策略引擎必须是确定性的基础设施，不是另一个 agent。
4. **E2E 与超级管理员可见性是根本冲突**。必须产品化决定：agent 房间透明，人类私聊可选 E2E。
5. **Demo 层很拥挤，生产语义很薄**。真正缺的是：身份生命周期、预算、loop 控制、审批、审计、崩溃恢复、工作区隔离。
