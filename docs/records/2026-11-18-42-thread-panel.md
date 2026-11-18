# 2026-11-18-42 Thread 面板

- 记录时间：2026-11-18。
- 目标：C 轨道——把消息讨论收进 thread，不再把回复都堆在主时间线。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [09 协议](../09-agent-protocol.md) · [记录 39 分页](2026-11-18-39-history-pagination.md)

## 实现

- `MatrixClient.getThread(roomId,rootId)`：
  - 优先 `GET /rooms/:id/relations/:root/m.thread`；
  - Tuwunel 2.0 返回 `M_UNRECOGNIZED`，fallback 扫最近 5×200 条房间消息，按 `threadId===rootId` 过滤；按时间排序。
- Server：
  - `GET /api/rooms/:id/threads/:rootId?limit&from`：root + replies + reactions + next；root 必须是本房间文本消息。
  - `POST /api/rooms/:id/messages` 接受 `threadId`；校验 root 存在，发送 `m.thread`。
- UI：
  - 消息悬浮「讨论」→ 右侧 ThreadPanel；
  - 面板显示 root、回复、输入框；2s 轮询；
  - 移动端覆盖式面板。

## 验证

- script-peer DM：POST root 200，POST `threadId=root` 200；
- `GET threads/root` 200，返回 2 条回复（人类 thread reply + script-peer 的 thread 回复）；
- lint/build 通过；43 tests。

## 边界

- Tuwunel 没有 relations API，thread 只能扫最近约 1000 条房间消息；更早的 thread 看不到。
- Thread 无分页（next 恒 null）、无已读/未读计数、无 reaction UI、无 thread 列表/入口徽标。
- 主时间线不显示 thread 回复数，只有「讨论」入口。
- Thread root 删除/撤回未处理；无 UI 自动化测试。
- 所有 thread 仍共享房间成员；agent 会在 thread 中回复，但 thread 级投递/唤醒沿用房间规则。
