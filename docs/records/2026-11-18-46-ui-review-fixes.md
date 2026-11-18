# 2026-11-18-46 UI 实机检查与修复

- 记录时间：2026-11-18。
- 方式：agent-browser（Chrome 158）打开 `http://127.0.0.1:8790`，截图检查会话列表、聊天、thread、待办、深链；读取 page errors/console。
- 关联：[记录 43 PWA](2026-11-18-43-pwa-onboarding.md) · [记录 42 Thread](2026-11-18-42-thread-panel.md)

## 发现与修复

1. **未定义 CSS 变量**：`--text` / `--hair` / `--rail` / `--accent*` 在部分规则里不存在，导致 tool chip、profile、usage、thread “mine” 气泡颜色回退。
   - 改为现有变量：`--ink` / `--line` / `--bg` / `--own`；thread mine 用 color-mix。
2. **Service worker 名字是 network-first，实际 cache-first**：新构建可能永远拿缓存 index/assets。
   - 改成真正的 network-first，失败才回缓存；CACHE bump 到 `agent-im-v2`。
3. **Thread 面板实机可用**：发送 `UI thread test` 成功，script-peer 在 thread 内回复；截图确认。
4. **深链实机可用**：直接打开 `#/room/.../message/...`，目标消息获得 focus class 并滚动到视野。
5. **PWA 资源**：manifest/sw/icon 200；manifest MIME 已修正；SW 注册 active；页面无 console/page errors。

## 边界

- 只测了 Chromium 深色主题；没测 Firefox/Safari/移动真机。
- 没有跑 axe/Lighthouse；颜色对比度未系统审计。
- Thread 测试产生了真实 room 消息（script-peer，无成本）。
- SW v2 需要一次硬刷新/重新注册才能替换旧 v1 缓存；旧客户端可能短暂仍用旧缓存。
