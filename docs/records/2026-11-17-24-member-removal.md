# 2026-11-17-24 群成员移除

- 记录时间：2026-11-17 晚上。
- 目标：补齐“能邀请但不能移除”的协作基础。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [记录 23 运维](2026-11-17-23-ops.md)

## 实现

- `DELETE /api/rooms/:roomId/members/:agentId`：
  - 仅群聊；DM 返回 400“私聊请直接删除会话”；
  - agent 不存在/不在房间 → 404；
  - agent 正在跑 → 409；
  - `admin.leave(agent token, room)`；
  - 更新 `room.memberIds`，并调用 `Gateway.removeRoomMember` 更新 engine 成员、清掉该房间缓存的 room client（避免用已离开的 client 查成员导致 403）。
- UI：邀请 modal 增加“当前 agent 成员”列表和「移除」按钮；移除后刷新 bootstrap，modal 保持打开。
- API：`api.removeMember(roomId, agentId)`。

## 实测

- 创建临时群「成员移除测试2」：human + script-peer + intake。
- 移除 script-peer：200；bootstrap 成员变为 human + intake；房间还在。
- 删除临时房间：200。
- 第一次实现时 `syncRoom` 用已离开的 client 查询成员返回 403（移除其实已成功）；改为 `removeRoomMember` 直接更新 engine，复测 200。

## 边界

- 只能移除 agent；不能移除人类/自己/创建者（当前单人类）。
- DM 不能移除成员，只能删除会话。
- 没有批量移除/转移 owner。
- 群只剩人类时仍保留，需要手动删群。
- 正在跑的 agent 需要等空闲或先暂停。
