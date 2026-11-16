# 2026-11-16-13 团队模板：一次创建一组角色

- 记录时间：2026-11-16 下午。
- 状态：内置 2 个团队模板 + API + UI；自定义团队模板待做。
- 关联：[14 角色模板与计划](../14-role-templates-and-roadmap.md) · [13 MVP 架构](../13-mvp-architecture.md) · [12 权限/triage](2026-11-16-12-permissions-triage-usage.md)

## 做了什么

- `app/team-templates.mjs`：
  - `software-squad`：product-manager + architect + coder + reviewer + qa。
  - `review-squad`：researcher + reviewer + security。
- `GET /api/team-templates`；`POST /api/team-templates/:id/create {prefix,groupName}`：
  - 注册 N 个 Matrix 用户，ID 为 `<prefix>-<shortRole>`（如 `squad-pm`）；
  - 用对应角色模板创建 agent；
  - 创建一个群，把所有新 agent 拉进去；
  - 预先检查 ID 冲突，冲突返回 409。
- UI：Agents 页「创建小队」→ TeamModal：选模板、ID 前缀、群名；创建后打开群。
- 实测：`review-squad` + prefix `demo` → `@demo-researcher/@demo-reviewer/@demo-security`，群「评审小队」；API 返回 200。

## 边界

- 没有回滚：如果第 N 个 agent 注册失败，前面的会留下；目前靠 prefix 预检查和错误提示。
- 没有自定义团队模板/编辑角色组合的 UI。
- 每个小队创建 N 个 Matrix 用户；频繁创建会堆积账号，删除 agent 还没做。
- 默认 toolsMode=template、每日预算 0（不限），triage 用全局默认。

## 下一步

- 自定义团队模板（保存角色组合）。
- 删除/归档 agent，便于清理实验小队。
