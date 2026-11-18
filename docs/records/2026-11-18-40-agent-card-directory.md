# 2026-11-18-40 Agent Card / Directory

- 记录时间：2026-11-18。
- 目标：D 轨道第一步——agent 不只显示名字，还能看职责/边界/工具/capabilities，并支持按能力筛选。
- 关联：[14 角色模板](../14-role-templates-and-roadmap.md) · [13 MVP 架构](../13-mvp-architecture.md) · [15 术语](../15-glossary.md)

## 实现

- `GET /api/agents/:id/card`：role card（mission/responsibilities/boundaries/decisionRights/thinkingStyle/communicationStyle/tools/knowledgePacks/handoff/successCriteria）+ roles/domains + runtime capabilities + status。
- `GET /api/directory?q=`：按 name/displayName/role/template/mission/roles/domains 过滤，最多 100。
- UI：
  - ProfileModal 拉取 card，显示职责/边界/决策权/思维/沟通/交接/成功标准/工具/capabilities（可滚动）；
  - AgentsView 增加按名字/角色/模板/职责筛选。
- 测试：pm card 返回 4 条 responsibilities + capabilities；directory `q=产品` 返回 `pm`。

## 边界

- 没有独立的 Directory 页面/分页；AgentsView 本地筛选全部 agent。
- 没有能力级别 trust/owner/allowlist 的可搜索字段；domains 仍多为空。
- 没有 A2A Agent Card 端点/签名/外部发现。
- card 是模板静态内容，不包含实时任务/预算；Profile 里能看到 status。
- 没有 UI 自动化测试。
