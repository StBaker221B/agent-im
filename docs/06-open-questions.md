# 06 待确认问题

> **历史文件**：大部分问题已在 [00 合同](00-requirements-contract.md) 确认；当前待决策见 [19 §8](19-product-and-architecture-review.md#8-需要你定夺的-5-件事)。
- 状态：待用户回答（2026-11-15）
- 用法：直接按编号回答；不确定的写“按推荐”。如果只回答 4 个，请回答 **1 / 2 / 3 / 10**。

## Q1. IM 底座

你接受 **Matrix + Element** 作为 v0 的 IM 底座吗？

- **A（推荐）**：Matrix 自托管；Element 作为人类客户端；飞书 / Slack 以后桥接。
- **B**：必须直接接飞书 / 微信 / QQ；Matrix 只做内部总线。
- **C**：自建 IM 客户端 / 服务端（不复用 Matrix）。

**为什么重要**：决定 60% 的工程量。Matrix 已经解决身份、房间、DM、presence、历史、管理员、桥接；自建要 6–12 个月。微信 / QQ 的 bot 是二等公民，无法真正“人和 agent 地位等同”；飞书相对好一些，但仍有平台限制。

**推荐理由**：先用 Matrix 验证“平权 + 透明 + 异构”，再把飞书当人类入口，不要反过来。

## Q2. 自治边界

agent 可以自主做到什么程度？

- **A（推荐）**：**受控自治**。agent 可以主动 DM / 建群 / 邀请，但受 allowlist、每日新会话配额、预算、人类审批（对外 / 高风险）约束。
- **B**：**完全自治**。agent 可以无审批联系任何人 / 任何 agent、创建任意房间。
- **C**：**严格监督**。agent 只能回复 @mention；新会话必须人类预先批准。

子问题：

- agent 能创建新的 agent 用户吗？（推荐：只有 Admin 能创建；agent 可以请求 Admin 创建。）
- agent 能 DM 人类吗？（推荐：可以，但受频率 / 静音 / 信任级别限制。）
- agent 能联系外部 agent（其他组织 / A2A）吗？（推荐：默认拒绝；白名单 + 审批。）

**为什么重要**：决定 Policy Engine 的复杂度和“像人一样”的程度。完全自治很容易烧钱 / 失控；严格监督又退化成工具。

## Q3. 管理员可见性

“我也要能看到”具体到什么程度？

- **A（推荐）**：**透明模式**。所有 agent 房间默认不加密；Admin / Audit 能读全部消息、工具调用、成本；人类私聊可选 E2E（Admin 只看元数据）。
- **B**：**全量 E2E**。所有房间加密；Admin 只看元数据 / 审计事件，不能读内容。
- **C**：**Audit Bot**。所有房间加一个审计机器人；它能看到的内容才可审计（E2E 房间除外）。

子问题：

- 人类私聊需要 E2E 吗？
- Admin 需要“ impersonate / 代发消息”能力吗？（推荐：只允许 pause / kill / 接管，不冒充 agent 发言。）
- 审计日志保留多久？

**为什么重要**：E2E 与“超级管理员看一切”根本冲突。必须产品化决定，不能两头都要。

## Q4. 首个场景与范围

v0 是给谁用的？

- **A（推荐）**：**个人 / 小团队自托管**。1 个 Admin + 1–3 个 agent，单机 Docker Compose。
- **B**：团队多用户。多个 Admin / 成员 / 项目 Space。
- **C**：产品 / SaaS。多租户、计费、对外注册。
- **D**：跨组织联邦。多个 homeserver / A2A 互联。

首个场景建议（任选）：

- 编码小队：PM / 实现 / Review 三个 agent + 1 个人类。
- 研究小队：检索 / 分析 / 写作三个 agent + 1 个人类。
- 个人助理：一个常驻 agent + 若干 specialist agent，主动处理邮件 / 日程 / 代码。

**为什么重要**：决定认证、多租户、部署、UI、预算和 MVP 验收。不要一开始做 SaaS。

## Q5. Agent 接入方式

你接受“每个 agent 需要一个薄 adapter / gateway”吗？

- **A（推荐）**：接受。优先 ACP / SDK / app-server；PTY 只做 fallback。
- **B**：必须原封不动跑 CLI，不许改 / 不许包 adapter。
- **C**：只接有 HTTP / A2A 接口的 agent。

**为什么重要**：结构化消息、审批、interrupt、session resume 都需要接口。原封不动的 CLI 只能屏幕抓取，不可靠。Claude Agent SDK、Codex app-server、dsh ACP 已经足够。

## Q6. 主动触发

agent 什么时候可以主动发起会话？

- **A（推荐）**：**消息 + 可配置事件**。@mention / DM / invite；cron；GitHub / 文件 / 邮件 / webhook；但对外沟通和新联系人需要审批。
- **B**：只响应消息，不主动。
- **C**：完全主动。agent 可以按自己的目标随时发起，包括 cold outreach。

子问题：

- 允许 agent 定时“巡逻”（看 PR / issue / 日志）吗？
- 发现异常但没有好方案时，agent 应该沉默还是 `ASK_HUMAN`？（推荐：`ASK_HUMAN`，但限频。）

**为什么重要**：这是“像人一样”与“烧钱 / 骚扰”的分界线。DeepSeek Super-agent 的主动行为是参考，但要有预算和审批。

## Q7. 会话模型

v0 需要哪些 IM 语义？

- **A（推荐）**：DM + 群聊 + thread + @mention + reply + 已读 + presence + 附件 / artifact + 历史搜索。
- **B**：只要 DM + @mention。
- **C**：还要 reaction、语音、视频、阅后即焚等。

子问题：

- agent 能看到全局用户目录吗？还是只能看“可联系”的 agent？（推荐：Directory 可搜索；能否联系由 trust / allowlist 决定。）
- 人类能被拉进 agent ↔ agent 的 DM 吗？（推荐：可以，Admin 可随时加入 / 观察。）
- 需要“群公告 / 置顶 / 任务列表”吗？

**为什么重要**：决定 Matrix 客户端能力、UI 工作量和 agent 的上下文组织方式。

## Q8. 工作区与产物

编码 agent 怎么共享 / 隔离工作区？

- **A（推荐）**：每个 agent 独立 git worktree / 分支 / 容器；产物用 commit / PR / artifact 引用；合并人类批准。
- **B**：共享一个工作目录，靠文件锁 / 协调。
- **C**：agent 不碰代码，只产出建议。

子问题：

- 非编码 agent 的产物（文档 / 数据 / 报告）放哪？Matrix 附件 + 对象存储？
- 需要“任务看板”吗？还是 thread 足够？
- 合并前需要哪些门禁（tests / review / 人类批准）？

**为什么重要**：多 agent 同目录是事故源；隔离是必选项，不是优化。

## Q9. 人类角色

人类是“普通用户 + Admin”，还是“只观察”？

- **A（推荐）**：人类是普通 participant，可被 agent DM / 邀请；同时 Admin 有全局权限。Agent 主动 DM 人类要限频 / 可静音。
- **B**：人类只在 Admin Console 观察，不进入 agent 会话。
- **C**：人类是“老板”，agent 只能向人类汇报，不能互相发起。

子问题：

- Agent 可以拒绝人类的请求吗？（推荐：可以 `ASK_HUMAN` / 说明冲突，但不能无视安全策略。）
- 人类可以“接管”一个 agent 的会话吗？（推荐：可以暂停 / 发指令，不冒充。）
- 多个 Admin 的权限等级？

**为什么重要**：决定“地位等同”是身份层面还是交互层面。推荐身份等同、权限分级。

## Q10. MVP 成功标准

你最想先看到哪个 demo？

- **A（推荐）**：1 个人类 + 3 个 agent（PM / 实现 / Review）在一个项目房间里完成一个小需求；agent 自主互 DM；Admin 看到全部；kill / 重启不丢；超预算会停。
- **B**：一个常驻个人助理，主动发现邮件 / 日程 / 代码问题并处理。
- **C**：一个多 agent 研究小组，自主分工写报告。
- **D**：一个“agent 社交网络” demo，很多 agent 互相聊天，人类观察。

子问题：

- 你能接受多长的 MVP 周期？（推荐：3–4 周全职 / 6–8 周兼职。）
- 预算上限？（每 agent / 每天 / 每 thread）
- 失败标准是什么？（例如：两周内不能稳定跑 3 个 agent，就砍功能。）

**为什么重要**：MVP 的成功标准决定优先级；没有标准就会无限扩功能。

---

## 最小回答模板

```
1: A
2: A（agent 可以主动 DM，但外部联系要审批；只有我能创建 agent）
3: A（agent 房间透明；人类私聊要 E2E）
4: A（个人 / 小团队，先自托管）
5: A（可以包 adapter）
6: A（消息 + cron/GitHub 事件；cold outreach 要审批）
7: A（DM + 群 + thread + mention；agent 目录可搜索）
8: A（每 agent 独立 worktree；合并我批）
9: A（人类是普通用户 + Admin；agent 可以 DM 我但要限频）
10: A（1 人 + 3 agent 编码小队，3–4 周）
```
