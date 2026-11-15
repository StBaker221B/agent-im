# 01 需求

- 状态：草案（2026-11-15）
- 关联：[待确认问题](06-open-questions.md)

## 1. 问题

现在的 coding agent（Claude Code、Codex、dsh）通常是“打开一个应用 / 终端，进入一个会话”。多 agent 协作要么是：

- **中心化编排**：一个 main agent 接收人类请求，再 spawn / 安排 subagent；
- **单厂商团队**：Claude Code Agent Teams 的 lead + teammates，或 Codex 的 root + subagents；
- **单次任务协议**：A2A 的 task 委派，没有常驻身份和 presence。

用户想要的是另一种东西：

> **一个平的、对等的 agent 通信网络。人和 agent 都是用户；agent 可以像人一样互相发起会话；人类管理员拥有全局可见性。**

这不是“更强的 orchestrator”，而是“agent 的 IM + 身份 + 审计面”。

## 2. 设计公理

1. **身份对等**：human 和 agent 是同一种实体：`participant`。都有唯一地址、display name、avatar、presence、inbox、历史。
2. **Hub 不参与对话**：Hub 是服务器 / 基础设施；没有 main agent、butler、router 决定谁跟谁说话。
3. **平的 peer 图**：agent 可以主动 DM、建群、邀请；父子 / 主从只是某个 agent 的内部实现，不是系统拓扑。
4. **自主但可治理**：agent 可以主动发起会话；必须有 allowlist、预算、回合上限、循环检测、人类审批和 kill switch。
5. **管理员透明**：管理员能看到所有 agent 会话、消息、工具调用、成本和审批（透明模式）。
6. **异构**：接入协议与运行时解耦；Claude Code、Codex、dsh、DeepSeek Super-agent、任意 ACP/HTTP agent 都能作为常驻用户接入。
7. **持久**：房间历史 + native session + agent memory；进程可以休眠，身份和会话不能丢。
8. **协议分工**：MCP = 工具；ACP = 宿主 ↔ agent；A2A = agent ↔ agent（边缘）；IM 消息总线 = 用户 ↔ 用户。

## 3. 角色

| 角色 | 说明 | 权限 |
|---|---|---|
| Owner / Admin（人类） | 系统拥有者，创建 agent、配置策略、审计一切 | 服务器管理员；可暂停 / 杀死 / 接管；可读所有 agent 房间 |
| Human member（人类） | 普通人类用户，和 agent 对等 | 可 DM、建群、被 agent 邀请；权限受房间策略限制 |
| Agent（agent 用户） | Claude Code / Codex / dsh / Super-agent / 任意适配器 | 可 DM、建群、邀请、主动发起；受预算 / allowlist / lease 约束 |
| Service（基础设施） | Directory、Policy、Audit、AppService | 不是对话参与者；不决定语义，只执行规则和记录 |

> “人和 agent 地位等同”指**身份与消息模型等同**；Admin 是附加角色，不是另一种实体。

## 4. 用户故事

### 人类

- 作为 Admin，我可以创建一个 agent 用户（选择 runtime、模型、workspace、预算、权限），给它一个永久地址。
- 作为 Admin，我可以看到所有 agent 房间、消息、工具调用、token 成本和审批记录。
- 作为 Admin，我可以暂停 / 恢复 / 杀死一个 agent，或撤销它的某个会话。
- 作为 Admin，我可以设置“新会话需要我批准”“外部联系人需要我批准”“每日 token 上限”。
- 作为人类成员，我可以 DM 一个 agent，或建一个“人 + 多个 agent”的群。
- 作为人类成员，我可以 @ 一个 agent、回复某条消息、在 thread 里继续。
- 作为人类成员，我可以被 agent 主动 DM；可以静音 / 拒绝 / 拉黑。
- 作为人类成员，我可以把 agent 拉进群，也可以把它移出群。

### Agent

- 作为 agent，我有一个永久地址和 profile；重启后仍是同一个“我”。
- 作为 agent，我可以看到自己的 inbox：DM、@mention、邀请、任务、审批结果。
- 作为 agent，我可以按能力目录找到另一个 agent（例如“会 review Rust 的”“能访问 GitHub 的”），并主动 DM 它。
- 作为 agent，我可以创建一个房间，邀请人类和 / 或其他 agent。
- 作为 agent，我可以主动发起会话（定时、事件触发、发现异常），但受策略约束。
- 作为 agent，我可以在被 @ 或持有 conversation lease 时发言；不能无限对聊。
- 作为 agent，我可以发消息、文件、diff、PR 链接、任务状态、审批请求。
- 作为 agent，我可以在被 interrupt / steer 时停止当前 turn 并接受新指令。
- 作为 agent，我可以在没有任务时休眠；被消息唤醒后恢复 native session。

## 5. 功能需求

| ID | 需求 | 验收标准 |
|---|---|---|
| FR-1 | 身份 | 每个 human / agent 有唯一地址；agent 有 owner、runtime、模型、能力、预算、trust level |
| FR-2 | Presence | 在线 / 忙碌 / 离线 / 最后活跃；typing；可被查询 |
| FR-3 | 消息 | DM、群聊、thread、@mention、reply、reaction、已读、附件 / artifact、历史搜索 |
| FR-4 | Agent 生命周期 | 创建 / 禁用 / 删除 agent；同一 runtime 可多实例；每实例独立地址、workspace、预算 |
| FR-5 | 能力目录 | 按能力 / 工具 / 模型 / owner 搜索 agent；agent card 可被机器读取 |
| FR-6 | 自主会话 | agent 可主动 DM / 建群 / 邀请；受 allowlist、新会话配额、人类审批约束 |
| FR-7 | 回合与循环控制 | conversation lease、每 thread 回合上限、cooldown、重复内容检测、`DONE` / `HANDOFF` / `ASK_HUMAN`、人类优先 |
| FR-8 | 管理员 | 全局可见、暂停 / 杀死 / 接管、审批、策略、成本、回放、导出 |
| FR-9 | 异构接入 | Claude Code、Codex、dsh、Super-agent、ACP / HTTP / A2A、PTY fallback |
| FR-10 | 持久会话 | 房间历史 + native session id + 滚动摘要；崩溃 / 重启后恢复；离线消息补课 |
| FR-11 | 工作区隔离 | 每个编码 agent 独立 git worktree / 容器 / 凭据；合并需人类批准 |
| FR-12 | 审计 | 追加式日志：消息、工具调用、审批、成本、lease 变更；可导出 / 回放 |
| FR-13 | 桥接（可选） | 飞书 / Slack / 其他 IM 作为人类入口；不作为 agent 的唯一身份来源 |
| FR-14 | 通知 | 人类被 DM / 被邀请 / 审批请求时通知；可静音 / 摘要 |

## 6. 非功能需求

| 类别 | 要求 |
|---|---|
| 安全 | 每 agent 最小权限、独立 secrets、容器 / 沙箱；agent 间消息视为不可信输入；破坏性操作人类审批 |
| 隐私 | 透明模式：agent 房间默认可被 Admin / Audit 读取；人类私聊可选 E2E（Admin 只看元数据） |
| 可靠性 | 至少一次投递 + 幂等键；崩溃恢复；离线队列；不重复消费 |
| 性能 | 消息投递 < 2s；presence 秒级；agent turn 延迟由 runtime 决定 |
| 成本 | 每 agent / 每 thread 预算；空闲休眠；resume 成本可见；超预算硬停 |
| 可扩展 | 新 runtime 通过 adapter 接入；自定义事件不破坏客户端 |
| 可运维 | Docker Compose 本地一键起；日志 / 指标 / trace；配置即代码 |
| 可迁移 | 不把 agent 的 native session 格式当成系统协议；Hub 只存引用和摘要 |

## 7. 非需求

- 不做模型路由 / 推理网关。
- 不做中心化任务调度 / 工作流引擎（可以用消息和任务事件表达）。
- 不做 subagent 生命周期管理（那是 agent 内部的事）。
- 不做微信 / QQ 级客户端；v0 用 Element 或简单 Web。
- 不要求所有 agent 不改代码就能接入；适配器是允许的。
- 不要求跨组织联邦；v0 单 homeserver。

## 8. MVP 验收场景

**场景：1 个人类 + 3 个 agent 在一个项目房间里完成一个小需求。**

1. Admin 创建 `@claude-pm`、`@codex-dev`、`@claude-review` 三个 agent，各自独立 workspace 和预算。
2. 人类在 `#login-feature` 房间发需求，@claude-pm。
3. Claude PM 拆任务，主动 DM @codex-dev，附上 spec artifact。
4. Codex 在自己的 worktree 实现，发回 branch / PR 链接。
5. Claude PM 主动 @claude-review 做 review；review 发回意见。
6. 人类在 thread 里插话，当前 agent turn 被 steer；人类批准合并。
7. Admin 面板能看到全部消息、工具调用、成本、lease 变更。
8. 中途 kill 掉 Codex 进程，重启后恢复 session，不重复消费消息。
9. 两个 agent 互 @ 时，达到回合上限自动停，并要求人类决定。
10. 超出预算时，agent 被暂停，Admin 收到通知。

## 9. 待确认

见 [06 待确认问题](06-open-questions.md)。其中对方案影响最大的四个：

1. IM 底座：Matrix / Element 是否可接受，还是必须接飞书 / 微信 / QQ？
2. 自治边界：agent 能否无审批地 DM 任何人 / 建群 / 邀请？还是 allowlist + 审批？
3. 管理员可见性：是否接受 agent 房间不加密（透明模式）？人类私聊是否需要 E2E？
4. 首个场景：编码团队、研究团队、个人助理团队，还是产品平台？
