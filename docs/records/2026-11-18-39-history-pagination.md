# 2026-11-18-39 聊天历史分页

- 记录时间：2026-11-18。
- 目标：C 轨道——聊天不再只看最近 100 条，可以往上翻。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [记录 28 回复引用](2026-11-18-28-reply-to.md)

## 实现

- `MatrixClient.getMessagesPage` 返回 `{messages,start,end}`；旧的 `getMessages` 保留为 wrapper。
- Server：
  - `GET /api/rooms/:id/messages?limit=100&from=<token>` 返回 `{messages,next}`；
  - `limit` 1–200；
  - 只过滤 main thread 的文本消息。
- UI：聊天顶部「加载更早的消息」；用 `next` token 拉上一页，`mergeMessages` 按 id/时间合并；打开房间时重置分页 token。
- 轮询仍只拉最新 100 条，不会覆盖已加载的旧页。

## 验证

- pm DM：第一页 limit=5 有 next；用 next 拉第二页 limit=5，5 条；两页 id 无重叠；第二页时间早于第一页。
- lint/build 通过；43 tests（分页逻辑未加单测，靠 API 验证）。

## 边界

- 只支持 main thread；thread 面板仍未做。
- 搜索仍只扫每房间最近 100 条，没有搜索分页/索引。
- 加载更早时没有保持滚动位置；视觉上可能跳。
- Matrix pagination token 有时效/顺序假设；没有本地缓存。
- 没有“跳到某天/某条”或虚拟列表。
