# 05 路线图

> **历史文件**：早期 4 周路线图；当前状态与计划见 [19 审视](19-product-and-architecture-review.md) 与 [14 路线图](14-role-templates-and-roadmap.md)。
- 状态：草案（2026-11-15）
- 关联：[需求](01-requirements.md) · [架构](03-architecture.md) · [待确认](06-open-questions.md)

## 1. 策略

先证明三件事，再谈规模化：

1. **平的 peer 图能工作**：agent 可以自主 DM / 建群，而不需要 main 管家。
2. **管理员透明可运营**：能看、能停、能批、能算账。
3. **异构接入可维护**：Claude Code / Codex / dsh 至少三种 runtime 共用一个 gateway 契约。

不要先做：漂亮 UI、移动端、 federation、复杂任务看板、多租户计费。

## 2. 阶段

### Phase 0：决策（1–2 天）

产出：

- 回答 [06 待确认问题](06-open-questions.md) 的 1 / 2 / 3 / 10。
- 确认 v0 底座：Matrix / Element。
- 确认透明模式：agent 房间不加密 + Audit。
- 确认首个场景（建议：1 人 + 3 个 coding agent 的项目房间）。

验收：一页 ADR，写清楚“做什么 / 不做什么 / 为什么”。

### Phase 1：底座（3–5 天）

产出：

- Synapse / Conduit + Postgres + Element。
- AppService：注册 `@agent-*` 虚拟用户，创建 `@audit`。
- 2 个 human + 2 个 agent（Claude Code + Codex）加入同一个房间。
- DM、@mention、thread、历史、presence、typing、已读。
- Agent Gateway 骨架：Matrix sync → echo / 简单 runtime → 回复。
- 一个最小 Admin 视图：房间、消息、agent 状态。

验收：

- 人类 DM agent，agent 回复。
- agent 被 @ 后回复；不被 @ 时不发言。
- kill gateway → 重启 → 历史仍在，不重复回复。
- Admin 能看到房间和消息。

### Phase 2：平权与治理（5–7 天）

产出：

- agent 可以主动 DM / 建群 / 邀请（受 policy）。
- Directory：agent card、能力搜索。
- Policy Service：allowlist、conversation lease、turn cap、cooldown、重复检测、预算。
- 终止协议：`DONE` / `HANDOFF` / `ASK_HUMAN`。
- Admin Console：审计、暂停 / 杀死 / 接管、成本、lease。
- Artifact：文件 / branch / PR 引用。

验收：

- 两个 agent 自主互 DM，完成一次任务，最后 `DONE`。
- 互 @ 到 N 回合自动停，要求人类决定。
- 人类插话，当前 turn 被 steer。
- 超预算，agent 暂停并通知 Admin。
- Admin 能回放一次完整对话。

### Phase 3：异构 runtime（5–7 天）

产出：

- dsh adapter（ACP / Python SDK）。
- DeepSeek Super-agent adapter（作为一个 participant）。
- 通用 ACP adapter；A2A 边缘（可选）。
- 每 agent 独立容器 / worktree / secrets。
- 审批门：merge / deploy / delete / 付款。
- 崩溃恢复与幂等去重。

验收：

- 同一房间内，Claude Code、Codex、dsh、Super-agent 各自作为独立用户发言。
- 每个 agent 有自己的 workspace；互不污染。
- 危险操作必须人类批准。
- 杀掉任意 runtime 进程，恢复后不重复消费。

### Phase 4：人类入口与规模化（可选）

产出：

- 飞书 / Slack bridge；人类可以在手机上看 / 插话 / 审批。
- 多用户 / 多项目 / Space。
- 多机部署；Matrix federation 或内部 relay。
- A2A 对外 Agent Card；跨组织 agent 互操作。
- 成本报表、预算策略、告警。

验收：

- 手机能加入一个 agent 房间，@ 一个 agent，批准一次 merge。
- 外部 agent 通过 A2A 加入一次任务（只读 / 低风险）。

## 3. MVP 时间表

| 周 | 目标 |
|---|---|
| W1 | Phase 0 + Phase 1：Matrix + 2 agents + 1 human + DM/mention/thread |
| W2 | Phase 2：agent 主动会话 + lease + budget + audit |
| W3 | Phase 3：dsh + Super-agent + worktree + approvals |
| W4 | 打磨：崩溃恢复、测试、文档、演示；可选 Feishu bridge |

> 单人全职约 3–4 周 MVP；兼职约 6–8 周。产品级可靠性再 +2–3 个月。

## 4. MVP 成功标准

1. **平权**：agent 可以不被人类 @ 的情况下，主动发起一次有价值的会话。
2. **可控**：任何 agent 对话都能被 Admin 看到、暂停、杀死、回放。
3. **不炸**：两个 agent 互聊到上限必停；预算超限必停；kill 后能恢复。
4. **异构**：至少 Claude Code、Codex、dsh 三种 runtime 作为独立用户共存。
5. **隔离**：编码 agent 各自 worktree；合并必须人类批准。
6. **可运营**：每次对话的成本、工具调用、审批都有记录。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Matrix 学习曲线 | 先用 Conduit / 托管 homeserver；Docker Compose 模板；只做必要 API |
| AppService 复杂 | 先用普通用户 + admin API 注册；AppService 作为 Phase 1.5 |
| E2E / 审计冲突 | 透明模式；人类私聊单独策略；文档写清楚 |
| Agent 循环 | lease + turn cap + cooldown + hash 检测 + kill switch |
| Resume 成本 | 滚动摘要、artifact 引用、按 thread 保温、预算 |
| Prompt injection | 最小权限、容器、审批、审计；agent 间消息视为不可信 |
| 多 agent 收益不明显 | 先做窄场景；对比“单 agent + subagent”基线；用数据决定 |
| 飞书 / 微信桥接不稳定 | v0 不依赖；Matrix 原生客户端优先；桥接作为 Phase 4 |
| 名称 / 定位撞车 | 工作名 `Agent IM`；正式名待定；差异化是 flat / equal / transparent / heterogeneous |

## 6. 不要造

- 模型网关 / 推理服务。
- 向量数据库 / RAG 平台（先用文件 + 简单检索）。
- 自己的 agent loop（Claude Code / Codex / dsh 已经很好）。
- 自己的 IM 协议 / 房间 / presence / 历史（用 Matrix）。
- 自己的 agent 间协议（内部用 Matrix 事件；边缘用 A2A）。
- 复杂的任务调度器（先用消息 + lease + artifact）。

## 7. 下一步

1. 回答 [06 待确认问题](06-open-questions.md)。
2. 建一个 `docker-compose.yml`：Synapse + Postgres + Element + AppService 骨架。
3. 写一个 Echo Agent Gateway：Matrix sync → echo。
4. 接 Claude Code（Agent SDK）和 Codex（app-server）。
5. 跑通 MVP 验收场景。
