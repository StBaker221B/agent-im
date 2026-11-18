# 2026-11-18-44 消息深链

- 记录时间：2026-11-18。
- 目标：C 轨道——消息可复制链接/从 URL 定位。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [记录 39 分页](2026-11-18-39-history-pagination.md)

## 实现

- hash 路由从 `#/room/<id>` 扩展为 `#/room/<id>/message/<eventId>`；解析时设置 activeRoomId + focusMessageId。
- 搜索结果打开时写入深链；ChatView 已有 focusId 滚动/高亮逻辑。
- 消息悬浮「链接」→ 复制完整 URL；clipboard 不可用时把 URL 放进 toast。
- 普通打开房间仍清空 focus。

## 验证

- lint/build 通过；43 tests。
- 未跑浏览器自动化；依赖已有 focusId 滚动逻辑。

## 边界

- 深链只能定位当前加载的最近 100 条（或已加载分页）；更早消息不会自动翻页查找。
- 没有链接预览/OG、权限校验（本地单人类）、消息删除后的失效提示。
- 复制的是 origin+pathname+hash；PWA standalone 内打开会交给浏览器。
- 没有“复制房间链接”单独入口。
