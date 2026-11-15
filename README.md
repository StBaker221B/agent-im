# Agent IM（工作名）

> 一个平的、对等的 agent 通信网络：人和 agent 都是用户；agent 可以像人一样互相发起会话；人类管理员拥有全局可见性。

- 状态：概念 / 调研（2026-11-15）
- 位置：`d:\Git\learn\agent-im`
- 名称说明：`Agent IM` 是工作名；GitHub 上已有同名项目（见 [02 现有项目调研](docs/02-prior-art.md)），正式名称待定。

## 一句话

不是“一个 main agent 调度一堆 subagent”，而是“一个 IM 服务器 + 每个 agent 一个常驻用户 + 一个管理员审计面”。

## 核心原则

1. **身份对等**：human 和 agent 都是 `participant`，有唯一地址、资料、presence、inbox。
2. **Hub 是基础设施，不是参与者**：没有 main / butler / router 决定谁跟谁说话；策略引擎是确定性基础设施，不是另一个 agent。
3. **平的 peer 图**：agent 可以 DM、建群、邀请；不要求父子或主从关系。
4. **自主会话**：agent 可以主动发起会话；受 allowlist、预算、回合上限、循环检测约束。
5. **超级管理员可见**：管理员能看到所有 agent 会话、消息、工具调用和成本（透明模式）。
6. **异构接入**：Claude Code、Codex、dsh（DeepSeek Harness）、DeepSeek Super-agent、任意 ACP/HTTP agent 都能作为常驻用户接入。
7. **持久**：房间历史 + native session + agent memory；断线重连、离线补课。

## 不是什么

- 不是模型 / agent loop；不重造 Claude Code、Codex、dsh。
- 不是中心化任务调度器；可以有任务消息，但 Hub 不分配任务。
- 不是 subagent 框架；agent 不是工具，是用户。
- 不是微信 / QQ 的 UI 克隆；v0 直接用 Matrix / Element。
- 不承诺所有房间 E2E 且管理员可读；这是产品取舍（见 [ADR-005](docs/03-architecture.md#adr-005透明模式优先于-agent-房间的-e2e)）。

## 与 OpenClaw / subagent 的区别

| | OpenClaw | Subagent（Claude Teams / Codex multi-agent） | Agent IM |
|---|---|---|---|
| 拓扑 | Gateway + main 管家 | 父子 / 主从 | 平的 peer 图 |
| 谁决定谁说话 | main | parent | agent 自己 + 策略引擎 |
| agent 身份 | 会话 / 子会话 | 工具调用 | 独立用户 |
| 人类角色 | 和 main 对接 | 发起者 | 普通用户 + 管理员 |
| agent 主动发起 | 受 main 安排 | 通常不能 | 可以，受策略约束 |

## 推荐路线

**Matrix homeserver + AppService 虚拟用户 + Agent Gateway + Policy/Audit + Element**。

理由：Matrix 已经解决了身份、DM、群聊、presence、已读、线程、mention、历史、附件、E2E、管理员 API、桥接和客户端。你要造的是 agent 特有的网关、目录、策略、审计和工作区隔离，不是 IM 协议。

## 文档索引

- [00 需求合同（草案）](docs/00-requirements-contract.md) — 唯一需求口径
- [01 需求](docs/01-requirements.md)
- [02 现有项目调研](docs/02-prior-art.md)
- [03 架构](docs/03-architecture.md)
- [04 Agent 接入](docs/04-agent-integration.md)
- [05 路线图](docs/05-roadmap.md)
- [06 待确认问题](docs/06-open-questions.md)
- [09 Agent 协议](docs/09-agent-protocol.md)
- [10 开发环境与复现](docs/10-dev-setup.md)
- [11 本地部署与无公网 IP 组网](docs/11-local-networking.md)
- [本地协议 spike](spike/) — 调度器/floor/静默收敛/共识 + Claude adapter + 测试
- [2026-11-15 会话笔记（过程记录）](docs/records/2026-11-15-01-session-notes.md)
- [2026-11-15 需求澄清（过程记录，含批注）](docs/records/2026-11-15-02-clarifications.md)
- [2026-11-15 第二轮答复（过程记录）](docs/records/2026-11-15-03-answers-round2.md)
- [2026-11-15 第三轮答复（过程记录）](docs/records/2026-11-15-04-answers-round3.md)
- [2026-11-16 Milestone A 记录](docs/records/2026-11-16-01-milestone-a.md)
- [NEXT-SESSION 新会话入口](NEXT-SESSION.md)
- [Sources](research/sources.md)

## 下一步

先读 [00 需求合同](docs/00-requirements-contract.md)、[09 Agent 协议](docs/09-agent-protocol.md)、[10 开发环境](docs/10-dev-setup.md)、[11 组网](docs/11-local-networking.md)。Milestone A 已跑通：`agent-im/spike` 14 个测试 + 真实 Claude adapter 三阶段 demo（总成本约 $0.043918，resume 保持 session）。下一步是 Matrix transport / 跨机组网 / 工具审批。新会话直接读 [NEXT-SESSION](NEXT-SESSION.md)。
