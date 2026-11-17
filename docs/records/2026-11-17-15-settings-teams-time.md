# 2026-11-17-15 设置拆分、团队模板调整、记忆时间戳

- 记录时间：2026-11-17 上午。
- 触发：用户反馈“设置页应该放全局配置、agent 配置放 agent 页；agent 记忆没有时间；团队模板角色不合理；流式看不出来”。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [14 角色与计划](../14-role-templates-and-roadmap.md) · [记录 14 流式/审批](2026-11-17-14-streaming-and-tool-approval.md)

## 设置页拆分

- 全局「设置」只保留：系统信息、用量表、Agent 配置入口说明。
- 每个 agent 在 Agents 页有「设置」按钮；资料弹窗也有「设置」。
- Agent 设置页包含：显示名、标签、角色模板、唤醒策略、状态、triage 冷却/每小时上限/skipAcks、工具权限、每日预算、已批准工具、系统提示。
- 深链：`#/agents/<agentId>/settings`；返回 Agents。
- 组件：`AgentSettings.jsx`（表单）+ `AgentSettingsView.jsx`（页面）；`SettingsView` 只保留全局。

## 记忆时间

- `buildAgentPrompt` 增加：
  - `Current time: ... (local server time)`；
  - recent messages 每条带 `[时间]`；
  - 新消息单独带 `at 时间`；
  - 指示“没有时间戳的旧记忆要说自己不确定，不要猜昨天/今天”。
- 实测：pm 回答“2026 年 11 月 17 日 08:15（本地服务器时间），星期一”。
- 旧 transcript 里已经存在的消息没有时间戳，无法追溯；新消息开始带时间。

## 团队模板调整

- `software-squad`：product-manager + business-analyst + architect + coder + reviewer + qa。
  - PM 负责用户问题、目标和优先级；BA 负责业务流程、规则、边界。解决“没有需求方”的疑问。
- `review-squad` 改名为「方案评审小队」：architect + reviewer + security。
  - 只做方案/风险评审，不做调研；security 用于安全相关方案，不是所有评审都需要。
- 新增 `research-squad`：researcher + tech-writer。
  - 一个 researcher 足够查证；writer 把结论写成可读材料。
- 有效性：coder→reviewer 协作和自主修测试实验验证过；2026-11-17 的单 coder vs coder+reviewer pilot 见[记录 16](2026-11-17-16-team-pilot.md)：简单 bug 上团队成本 3×、耗时 4.7×，质量相同；6 人小队仍未做完整对照。

## 流式可见性

- 之前 `turn_end` 立刻删除实时气泡，短回复来不及看到。
- 现在 `turn_end` 后保留 2.2s，标“刚输出”，再被最终 Matrix 消息替代；长回复/工具循环更容易看到。
- 流式的价值在长回答和 tool_use 过程；一句话回复本来就会很快结束，不会特别明显。

## 成本数据来源

- `ClaudeAdapter` 从 CLI result 读 `total_cost_usd`，作为 `usage.costUsd` 写 audit。
- 用量表和每日预算都累加这个值；不是前端按 token 单价估算，也没有本地价格表。
- token 数在 usage 里保留，但只用于观察，不参与计价。

## 其他确认

- **分支**：`agent-im/matrix-e2e` 是早先为 WSL2 + Tuwunel + 真实 Matrix E2E 开的工作分支；后续所有功能都留在上面，master 还停在 15 个提交前。没有自动合并/推送。
- **执行前审批**：不做默认。Claude 的 auto/dontAsk 模式保留；工具被拒时走现有的 `REQUEST_TOOL` 合作式申请。pre-execution `control_request` 只是备选设计，见记录 14。
- **agent 自主建群/私聊**：目前不支持；只有人类能建房间，agent 只能在已有房间内 @ 其他成员。
