# 2026-11-17-27 桌面通知

- 记录时间：2026-11-17 晚上。
- 目标：补最基础的“后台有新消息”提醒；不做完整通知中心。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [记录 20 活动/审计](2026-11-17-20-activity-and-global-pause.md)

## 实现

- 全局设置新增「通知」：开启/关闭桌面通知。
- 首次开启调用 `Notification.requestPermission()`（用户手势），偏好存 `localStorage.agentim.notifications`。
- App 在 `document.hidden` 且未读数增加时，找最近一条未读消息所在房间，弹 `new Notification(room.name, {body: sender: text})`。
- 同一条消息 id 只通知一次（`notifiedRef`）。
- 标签页可见时不弹。

## 边界

- 没有 @mention 单独提醒/未读 @ 计数；任何未读都会通知。
- 通知点开不会自动跳房间（没有 notification click 处理）。
- 只支持单人类/本机浏览器；没有飞书/Slack/邮件通知。
- 没有静音时段/摘要/免打扰。
- 浏览器/系统权限被拒时不重复打扰，只在设置页可重试。
- 没有自动化 UI 测试；只过 lint/build。

## 下一步

- @ mention 未读与优先通知。
- 点击通知跳转到对应房间/消息。
- 审批/任务失败/预算告警通知（服务端事件驱动）。
- 静音/摘要/免打扰。
