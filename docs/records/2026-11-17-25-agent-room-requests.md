# 2026-11-17-25 Agent 申请房间（人类批准）

> **2026-11-18 更新**：默认策略已改为 `agentRooms=open`，agent 申请会直接建群（仍含人类）；可在设置收紧为 approval。以 [记录 30](2026-11-18-30-autonomy-open.md) 为准。

- 记录时间：2026-11-17 晚上。
- 目标：让 agent 能发起“我需要一个侧房间”的请求，但不自己建、不绕过人类。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [记录 24 成员移除](2026-11-17-24-member-removal.md)

## 规则

- Agent 回复：
  - `REQUEST_ROOM: dm @agent <原因>`
  - `REQUEST_ROOM: group "名称" @a @b <原因>`
- Gateway 解析 kind/name，用 `#resolveMentions` 解析目标 agent；生成 `intent=room_request` 消息，Matrix custom content `com.agentim.room={kind,name,agentIds}`。
- UI 显示「创建私聊（人类可见）」/「创建群」按钮；人类点击才调用 `POST /api/rooms` 建群。
- 房间成员 = 人类 + 发起 agent + 目标 agents；**没有人类不可见的 agent-only DM**。
- `createGroup` 对同名 + 同成员集合的群做幂等：重复批准返回已有房间，不重复建。
- Agent 不能自己调用创建 API；只能发请求。

## 实测

- PM 输出 `REQUEST_ROOM: dm @intake 测试房间申请`。
- 消息 intent=`room_request`，room=`{kind:"dm",name:"私聊-需求顾问",agentIds:["@intake"]}`，文本“申请创建私聊：@需求顾问（人类可见）”。
- 模拟批准：创建群，成员 human+PM+intake。
- 再次批准同名同成员：返回同一房间，`existing:true`。
- 删除测试房间。

## 边界

- 没有 agent-only 私聊；所有房间人类可见（符合透明模式）。
- 没有 allowlist/频率配额/审批记录表；人类每次都手动点。
- 群名由 agent 提议，可能重复；当前靠同名同成员幂等。
- 请求消息不会自动标记“已处理”；按钮仍在，但重复点击会复用房间。
- 没有跨组织/外部 agent 邀请。

## 下一步

- allowlist/新房间配额/审批审计。
- 把“已处理”状态持久化，UI 隐藏按钮。
- agent-only 私聊（如果未来需要）必须单独设计可见性与 Admin 审计。
- 与 intake 的团队建议联动：批准后一次建“小队 + 群”。
