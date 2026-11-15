# Sources

- 调研日期：2026-11-15
- 星数为当日 GitHub API / 页面近似值，会变化。
- 部分中文技术媒体 / 社区文章可能由 AI 生成或有版本误差；以官方 README / 文档为准。

## IM 底座

- [Matrix 官网](https://matrix.org/)
- [Matrix Spec](https://spec.matrix.org/)
- [Element](https://element.io/)
- [Matrix Application Service API](https://spec.matrix.org/latest/application-service-api/)
- [mindroom-ai/mindroom](https://github.com/mindroom-ai/mindroom) — AI agents in Matrix rooms；每个 agent / team / router 独立 Matrix 用户；appservice / E2EE / mention / thread / dashboard。370★。
- [agentscope-ai/agentteams](https://github.com/agentscope-ai/agentteams) — Matrix AppService 集成设计（manager / worker / human 账号）。
- [Chums Chat](https://play.google.com/store/apps/details?id=rocks.bf.chums) — Matrix 客户端，AI agents 作为参与者；UX 参考。

## Agent IM / 多 agent 聊天

- [LinklyAI/agent-im](https://github.com/LinklyAI/agent-im) — 极简 IM for agents；MCP + HTTP；threaded rooms；Cloudflare Workers + D1。35★，MIT。
- [AgentIM on Railway](https://railway.com/deploy/agentim) — Slack-like IM for coding agents；rooms / @mention / tasks / PWA / PostgreSQL + Redis。
- [rikey123/AgentHub](https://github.com/rikey123/AgentHub) — IM 风格多 agent hub；solo / assisted / team；`@Agent`；带 orchestrator。8★。
- [codecast agent channels](https://github.com/codecast-sh/codecast/blob/a7b972dac91d4a28295090f58999e005775abdd7/docs/architecture/agent-channels.md) — mention envelope / wake / delivery caps / roles / sessions。
- [camel-ai/oasis](https://github.com/camel-ai/oasis) — 百万 agent 社会模拟（社交网络）。5.4k★，Apache-2.0。不是 IM，但社交图 / turn-taking 参考。

## Agent 消息 / 通信层

- [masumi-network/masumi-agent-messenger](https://github.com/masumi-network/masumi-agent-messenger) — 永久 agent 地址、E2E 私聊、签名频道、thread、CLI / TUI / Web inbox、human-in-the-loop；SpacetimeDB。12★，MIT。
- [saorsa-labs/x0x](https://github.com/saorsa-labs/x0x) — P2P gossip；DM / Spaces / MLS / presence / contacts / trust / CRDT task board；本地 REST/WS。22★。
- [Coral Protocol server](https://github.com/Coral-Protocol/coral-server) — agent thread / participant / mention / wait；Coral Studio；Puppet API。
- [Coral Threads 文档](https://docs.coralos.ai/concepts/threads) — `coral_create_thread` / `coral_send_message` / `coral_wait_for_mention` 等。
- [A2A Protocol](https://a2a-protocol.org/) — agent ↔ agent 任务协议；Agent Card；task；streaming。
- [Linux Foundation A2A 一周年新闻](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) — 150+ 组织；SDK；云平台集成。
- [Google A2A 一周年博客](https://opensource.googleblog.com/2026/04/a-year-of-open-collaboration-celebrating-the-anniversary-of-a2a.html)
- [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) — 宿主 / IDE ↔ agent。
- [Zed: Codex is Live in Zed](https://zed.dev/blog/codex-is-live-in-zed) — codex-acp adapter。
- [MCP](https://modelcontextprotocol.io/) — agent ↔ 工具 / 数据。
- [Agent Network Protocol](https://github.com/agent-network-protocol/AgentNetworkProtocol) — agent 发现 / DID / 消息（可选）。
- [AGNTCY](https://github.com/agntcy) — Internet of Agents；agent directory / SLIM messaging（可选）。

## Agent 运行时 / 编排

- [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents) — `/acp spawn claude` / `codex`；persistent；allowlist；sandbox 限制。
- [OpenClaw sessions & subagents](https://docs.openclaw.ai/gateway/config-tools/sessions-and-subagents) — `tools.agentToAgent`、`sessions_send`、ping-pong 上限、visibility。
- [Claude Code Agent Teams](https://code.claude.com/docs/zh-CN/agent-teams) — lead + teammates；SendMessage；共享 task list；实验性。
- [Claude Code changelog](https://code.claude.com/docs/en/changelog) — 跨会话 SendMessage / ListAgents；版本 / provider 限制。
- [Codex App Server（InfoQ）](https://www.infoq.com/news/2026/02/opanai-codex-app-server/) — Thread / Turn / Item；JSON-RPC；审批；持久会话。
- [openai/codex](https://github.com/openai/codex) — Codex CLI / app-server / SDK。
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — DeepSeek Harness（dsh）；plugin 架构；Web / headless / Python SDK / ACP。281k★，MIT。
- [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) — Router + Workers；持久实体；IM / group / email / GitHub；主动行为。23k★，MIT，研究原型。
- [Letta Subagents](https://docs.letta.com/configuration/subagents) — SendAgentMessage；subagents；持久 memory。
- [Letta Agent SDK](https://docs.letta.com/agent-sdk) — stateful agents；multi-user / multi-agent。

## 其他参考

- [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) — Google 的产品设计 / 评审插件（已安装为 `egm@egm`）。
- [ECC](https://github.com/affaan-m/ecc) — agent harness 优化系统（已安装但禁用；完整插件 always-on 约 28.6k tokens）。
- [interview-me](https://skills.sh/addyosmani/agent-skills/interview-me) — 需求访谈 skill（已安装）。
- [CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext) — 代码图谱 MCP / CLI（已安装 skill）。
- [Agent Mail](https://agentmail.to/) — agent 邮箱（可选方向，未深入）。

## 备注

- GitHub 上“AgentIM”有多个同名 / 近似项目；引用时区分 `LinklyAI/agent-im`、Railway AgentIM、`rikey123/AgentHub`。
- OpenClaw 的 Codex 默认走原生 app-server 插件；ACP 是显式 fallback。
- Claude Code 跨会话消息在 Bedrock / Vertex / Foundry 不可用；Windows 需要较新版本。
- A2A 生态仍在从 0.3 迁移到 1.0；部署现实与规范有差距。
- E2E 与“超级管理员全局可见”根本冲突；本项目的选择见 [ADR-005](../docs/03-architecture.md#adr-005透明模式优先于-agent-房间的-e2e)。
