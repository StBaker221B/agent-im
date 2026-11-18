# 2026-11-18-37 @/请求未读

- 记录时间：2026-11-18。
- 目标：C 轨道第一块——让“需要人关注”的消息在会话列表里可辨认。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [记录 27 桌面通知](2026-11-17-27-desktop-notifications.md) · [记录 35 待办](2026-11-18-35-alerts-inbox.md)

## 实现

- `roomSummary` 新增 `mentionUnread`：未读消息中满足任一条件：
  - `m.mentions` 包含人类 id；
  - 文本里出现 `@<人类名>`（大小写不敏感）；
  - intent 是 `ask_human` / `tool_request` / `room_request`。
- bootstrap 新增 `totalMentions`。
- Sidebar 房间行显示 `@` badge（与普通未读数并存）；tab title 优先显示 `(@n)`。
- 桌面通知标题在最近的房间有 mentionUnread 时加 `@ ` 前缀。
- 只统计最近 100 条消息窗口内的未读。

## 边界

- 没有 Matrix per-message read receipt；`lastReadTs` 是房间级。
- 文本 @人类名是启发式；display name 含空格/特殊字符时不可靠。
- 工具/房间请求也算“@”，与待办收件箱有重叠。
- 没有单独的“只看 @”筛选/通知权限；桌面通知仍是所有未读。
- 没做 UI 自动化测试；只过 lint/build。
