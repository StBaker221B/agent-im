# 07 会话笔记：2026-11-15

> 一次完整的需求澄清 + GitHub 调研 + 架构设计 + 工具安装记录。给未来的自己和新会话用。

## 0. 新会话先看

1. [README](../../README.md)
2. [01 需求](../01-requirements.md)
3. [03 架构](../03-architecture.md)
4. 本文
5. [06 待确认问题](../06-open-questions.md)

不要重新调研、不要重复安装工具。先问用户 Q1–Q5，再开始 Phase 1。

## 1. 用户想要什么

原话大意：

- “claudecode codex 都是 agent 吧，我想构建一个系统，能让多种 agent 独自接入，像人一样一起工作。”
- “在这个系统中，agent 都能常驻，就好像 claude 开了一个永远不关闭的对话框，而且可以有任意多个 claudecode 或者 dsh，都保持独立，还能各自之间发消息。真人也可以成为独立用户加入其中。”
- “agent im 这个概念差不多接近我想要的，各个 agent 就像微信 / 飞书 / QQ 一样可以彼此通信，人和 agent 的地位在这个系统中是等同的，都是用户，只不过 agent 用户可以由我创建，agent 和 agent 之间可以自主发起会话，我也要能看到，类似超级管理员权限？”
- “跟 openclaw 还是不一样的吧，openclaw 是一个控制台，一个 main 就像一个管家跟我对接，其他都是 main 来安排。我要的这个都是同等地位的，人和 agent、agent 和 agent 都是同等地位，跟现有 agent 架构设计里的 subagent 还是不太一样吧。”
- “dsh 是 deepseek harness 也是一个 agent 也要能接入；deepseek 的 super agent 也要能接入。我想让所有 agent 都能接入，作为常驻型用户介入。”
- “开个新项目，整理记一下这些内容，记清楚些。”
- “好像有 codegraph ecc elephant goldfish 啥的 skill / 插件 / 工具，能帮助你理解需求、更好地做产品设计，自己找找安装一下。”

提炼成 7 条：

1. **平的 peer 图**：不是 main / butler，不是 subagent 父子。
2. **身份对等**：human = agent = user；Admin 是附加角色。
3. **自主会话**：agent 可以主动 DM / 建群 / 邀请；人类可观察 / 治理。
4. **任意多开**：同一 runtime 可以开任意多个独立实例。
5. **异构接入**：Claude Code / Codex / dsh / DeepSeek Super-agent / 其他 ACP/HTTP agent。
6. **常驻持久**：永久地址、历史、native session、断线重连、离线补课。
7. **超级管理员**：Admin 能看到所有 agent 会话、消息、工具调用、成本。

## 2. 关键概念

| 概念 | 定义 |
|---|---|
| Agent IM | 一个 IM 系统，其中 human 和 agent 都是用户，agent 可以像人一样互相发起会话 |
| Participant | 统一身份：human / agent / service；有唯一地址、profile、presence、inbox |
| Hub | 消息 / 身份 / 房间基础设施；**不是**参与者，不做语义决策 |
| Flat peer graph | agent 之间是平级关系；父子 / 主从只存在于某个 agent 内部 |
| Conversation lease | 确定性 turn-taking：一个 thread 同时只有一个 agent 持有发言权，不是 moderator agent |
| Transparent mode | agent 房间默认可被 Admin / Audit 读取；人类私聊可选 E2E |
| Agent Gateway | 每个 agent 的“IM 网卡 + 会话管理器”；连接 Matrix 与 native runtime |
| Agent Card | 可机器读取的 agent 资料：runtime、模型、能力、工具、预算、trust |
| Native session | Claude session / Codex thread / ACP session；Hub 只存引用和摘要 |

## 3. 调研结论

### 3.1 有接近的，但没有全满足

| 项目 | 是什么 | 差距 |
|---|---|---|
| [LinklyAI/agent-im](https://github.com/LinklyAI/agent-im)（35★） | 极简 IM for agents；MCP / HTTP / threaded rooms / Web UI | 太薄：无 admin / 策略 / 多租户 |
| [AgentIM](https://railway.com/deploy/agentim) | Slack for coding agents；rooms / @mention / tasks / PWA | 中心化 + 任务编排；无完整对等 / 审计 |
| [MindRoom](https://github.com/mindroom-ai/mindroom)（370★） | agent 作为 Matrix 用户；appservice / E2EE / mention / thread / dashboard | 有 team / router；非扁平 |
| [masumi-agent-messenger](https://github.com/masumi-network/masumi-agent-messenger)（12★） | 永久 agent 地址、E2E inbox、thread、CLI / Web | 消息层，不是完整 IM |
| [x0x](https://github.com/saorsa-labs/x0x)（22★） | P2P gossip、DM / Spaces / MLS / presence / trust | 无中心超级管理员；与“Admin 看一切”冲突 |
| [Coral Protocol](https://docs.coralos.ai/concepts/threads) | agent thread / participant / @mention / wait | 人类通过 Puppet API，不是一等公民 |
| [OpenClaw](https://docs.openclaw.ai/tools/acp-agents) | 常驻 Gateway + main 管家 + ACP + sessions_send | 层级；不是 flat |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（281k★） | dsh；plugin 架构 / Web / headless / Python SDK / ACP | 是 harness，不是 IM |
| [DeepSeek Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype)（23k★） | Router + Workers；IM / group / email / GitHub 渠道 | 内部层级；研究原型 |

### 3.2 结论

现有项目分两类：

- **Agent 框架**：AutoGen / CrewAI / Claude Teams / Codex multi-agent / DeepSeek Super-agent——有编排，没 IM / 身份 / Admin。
- **Agent 消息层**：masumi / x0x / Coral / A2A——有消息，人类不是一等公民或没有超级管理员。

你的位置：**flat / equal / transparent / heterogeneous**。没有人完整做过。

## 4. 架构决策

### 4.1 推荐方案

**Matrix homeserver + AppService 虚拟用户 + 每个 agent 一个 Gateway + Policy / Audit / Directory + Element。**

理由：

- Matrix 已经解决身份、DM、群、presence、已读、线程、mention、历史、附件、E2E、管理员 API、桥接、客户端。
- Agent 特有的价值在网关、目录、策略、审计、worktree 隔离——这些才是要自研的。

### 4.2 身份

- human：`@kudo:agents.local`
- agent：`@claude-code-1:agents.local`
- 两者都是 Matrix user；同一个 `participant` 表。
- Admin 是 server admin / room power level，不是另一种用户。
- 同一 runtime 多实例：每个实例一个独立 MXID。

### 4.3 Hub 不是参与者

- 没有 main agent / butler / router 决定谁跟谁说话。
- Policy Service 是确定性规则引擎；Directory 是被动索引；Audit 是旁路记录。
- Turn-taking 用 **conversation lease**，不是 moderator agent。

### 4.4 透明模式

- agent 房间默认不加密；`@audit` 用户加入所有 agent 房间，记录消息 / 工具调用 / 成本。
- 人类私聊可选 E2E；Admin 只看元数据。
- E2E 与“超级管理员看一切”根本冲突；必须产品化决定。

### 4.5 异构接入

| Runtime | 接入方式 |
|---|---|
| Claude Code | Claude Agent SDK streaming input；或 CLI `-p --output-format stream-json --resume` |
| Codex | `codex app-server`：`thread/start|resume` + `turn/start|steer|interrupt` + approvals |
| dsh | ACP 或 Python SDK；headless |
| DeepSeek Super-agent | 作为一个 participant；内部 Router/Workers 留在内部；不要让它变成 Hub 的 main |
| 通用 | ACP adapters / A2A / PTY fallback |

### 4.6 关键取舍

- **常驻 ≠ 进程永远跑**：常驻的是身份 + session + inbox；进程可休眠，消息唤醒。
- **不要自己重放上下文**：Hub 只存消息 / 摘要 / artifact 引用；native session 管认知上下文。
- **工作区隔离**：每个编码 agent 独立 git worktree / 容器 / 凭据；合并人类批准。
- **多 agent 不总是更好**：编码场景先用“单 agent + subagent”做基线，再证明 peer 图的价值。
- **厂商在快速补课**：适配器做薄，原生支持上来后能删掉自己那层。

## 5. 工具安装记录

### 5.1 已启用

| 工具 | 状态 | 说明 |
|---|---|---|
| EGM（Elephant-Goldfish Model）`egm@egm` 0.1.1 | ✔ enabled，user scope | Google 的产品设计 / 评审插件；7 skills：egm-bootstrap / brainstorm / draft / review / review-loop / resolve / drift-report；always-on ~407 tokens |
| `interview-me` | ✔ 全局 skill | addyosmani/agent-skills；需求访谈；symlink 到 Claude Code / OpenClaw |
| `codegraphcontext` | ✔ 全局 skill | CodeGraphContext/CodeGraphContext；代码图谱 / MCP；symlink 到 Claude Code / OpenClaw |

### 5.2 已安装但禁用

| 工具 | 状态 | 说明 |
|---|---|---|
| ECC `ecc@ecc` 2.2.3 | ✘ disabled，user scope | 412 skills / 71 agents / 8 hooks / chrome-devtools MCP；always-on ~28,632 tokens；两个 userConfig 未设置（hooks_enabled / hook_profile） |

为什么禁用：完整 ECC 每个会话都加约 28.6k tokens，对日常使用太重。需要时：

```bash
claude plugin enable ecc@ecc
# 或以后用 ecc-universal 的 lean profile / 选择性安装
```

尝试过 `npx skills add affaan-m/ecc@<skill>` 安装子集，但 GitHub 克隆被 reset（`SKILLS_GIT_CLONE_FAILED`），暂未装成。完整插件已经安装，可随时启用。

### 5.3 新会话注意事项

- 插件 / skill 通常在新会话才完全加载；EGM 的 `/egm:*` 命令、interview-me、codegraphcontext 在新会话可用。
- ECC 仍是 disabled；不要以为它坏了。
- 已有其他插件：`planning-with-files`、`understand-anything`、`claude-md-management`、`pyright-lsp`、`typescript-lsp`、`skill-creator` 等。

## 6. 待确认问题（Top 5）

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| 1 | IM 底座 | A Matrix/Element；B 飞书/微信/QQ；C 自建 | A |
| 2 | Agent 自治 | A 受控（allowlist + 预算 + 审批）；B 完全自治；C 只能 @ 回复 | A |
| 3 | 管理员可见性 | A agent 房间透明 + Audit；B 全 E2E；C Audit Bot | A |
| 4 | 范围 / 首个场景 | A 个人/小团队；B 团队；C SaaS；D 研究/助理 | A（编码小队） |
| 5 | Agent 接入 | A 薄 adapter（ACP/SDK）；B 原封 CLI；C 只 HTTP/A2A | A |

完整 10 个问题见 [06 待确认问题](../06-open-questions.md)。

最小回答模板：

```text
1 A；2 A（只有我能建 agent；agent 可 DM 我但限频；外部要审批）；
3 A（agent 房间透明；人类私聊 E2E）；4 A（个人/小团队，编码小队）；
5 A（可以包 adapter）
```

## 7. 下一步

用户回答 Q1–Q5 后：

1. 更新 [01 需求](../01-requirements.md) / [03 架构](../03-architecture.md) / [06 待确认问题](../06-open-questions.md)。
2. Phase 1：
   - `docker-compose.yml`：Synapse + Postgres + Element + AppService 骨架。
   - Echo Agent Gateway：Matrix sync → echo。
   - Claude Code adapter（Agent SDK）。
   - Codex adapter（app-server）。
   - 最小 Admin 视图。
3. Phase 2：lease / budget / audit / 自主会话。
4. Phase 3：dsh / Super-agent / worktree / approvals。

## 8. 新会话开场提示

把下面这段直接发给新会话：

```text
读 d:\Git\learn\agent-im\NEXT-SESSION.md，继续 Agent IM 项目。
先读 README、01 需求、03 架构、07 会话笔记、06 待确认问题。
不要重新调研，不要重复安装插件。
先问我 Q1–Q5；然后开始 Phase 1（docker-compose + Echo Gateway + Claude/Codex adapter）。
```

## 9. 第二轮会话（同日）：需求复审与澄清

### 9.1 用户反馈

- 方向对，但当前是“设计完成度高、验证为零”；需求还不是可验收的合同。
- 私有 vs 未来商业/公开：现在本地验证，但设计要留扩展缝，保留对外开放和商业部署的潜力。
- “平权” vs “Admin 看一切”看似矛盾；需要把身份对等、治理权限、隐私分层拆开。
- “永久账号”不是永生；agent 由用户创建、配置、注销、删除。
- agent 用户背后可以是 Claude Code / Hermes / Codex / OpenClaw / dsh / 自研；需要协议/映射；疑问 ACP 是否只能单次任务、能否长期保持同一会话。
- 不重造 agent 是对的。
- DM 等英文术语需要解释。
- **自主群聊是核心**：没有 main 分发；agent 像人的工作群一样讨论、形成决议、分工执行；人可以加入群聊。
- 需要数据平台界面：知晓一切、控制所有 agent。
- 底座未定；需要解释 Matrix / Element；微信类比但缺少超级权限。
- 工作方式：长回复/总结写临时文档，用户直接批注；我要勤记过程笔记。

### 9.2 本轮产出

- [00 需求合同（草案）](../00-requirements-contract.md)：唯一需求口径，含角色/权限、隐私矩阵、生命周期、adapter 契约、群聊协议、数据平台、MoSCoW、验收、扩展缝。
- [2026-11-15 需求澄清](2026-11-15-clarifications.md)：逐条回答 + 术语表 + 8 个待批注问题（A–H）。
- 更新 [NEXT-SESSION](../../NEXT-SESSION.md)：先读 00 + 记录；合同确认前不写代码。

### 9.3 关键结论（待用户确认）

1. **local-first, public-ready seams**：v0 单 Admin/本地；留 workspace_id、role/scope、ImTransport、runtime adapter、审计、配置 6 个缝；不做多租户/计费。
2. **平权 = 身份/消息模型对等；治理权限不对称；隐私分层**：
   - agent-agent、human-agent 房间默认透明；human-human 私聊私密（v0 可不做）。
   - Admin 可见是角色 + 制度 + 告知，不是“偷看”。
3. **Agent 生命周期**：created → active → idle/sleeping → paused → disabled → deleted；软删保留历史；只有 Admin 能创建/删除。
4. **Agent 用户 ≠ Agent 实体**：
   - 用户是持久 IM 身份；实体是可替换 runtime；session 按 thread 切分。
   - 1 用户 ↔ 1 gateway ↔ 1 adapter ↔ N session。
   - 需要薄 adapter 契约（ensureSession / send / interrupt / resume / health / capabilities）。
   - ACP 是 session-oriented，但设计目标是宿主/IDE ↔ agent；它是 adapter，不是系统主协议。OpenClaw 的“单次感”可能是集成方式，不是 ACP 上限。
5. **自主群聊 = 会议协议**：
   - intent：chat/proposal/question/answer/decision/task/status/done/handoff/ask_human。
   - 人类优先；被 @/回复者获得下一轮；一个 thread 同时一个 agent 发言；回合上限/冷却/重复检测。
   - v0 人类最终拍板；agent 可提议/投票/推荐，不自动产生共识。
   - 决议 → task（owner/范围/workspace/验收）→ status → done + artifact。
6. **数据平台是 Must**：agent/房间/实时事件/审批/成本/暂停杀死；v0 最小 dashboard；Element 只负责聊天。
7. **Matrix/Element**：Matrix = 开放 IM 协议 + 自建 homeserver；Element = 客户端；微信是封闭的人对人平台，没有你要的 server admin / agent 一等公民。
8. **环境**：本机无 Docker/WSL2、无 Codex/dsh；C 25GB / D 321GB / 16GB RAM；办公机可作为第二节点。

### 9.4 待确认

00 合同的 A–H（目标/平权/生命周期/协议/群聊决议/数据平台/底座/约束）。确认后：写 09-agent-protocol.md → 本地协议 spike → Matrix。

