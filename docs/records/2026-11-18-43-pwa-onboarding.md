# 2026-11-18-43 PWA、首次引导、可访问性补丁

- 记录时间：2026-11-18。
- 目标：F 轨道第一批——让本地 Web 可安装、首次使用有路径、减少动效/辅助技术问题。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [19 §7](../19-product-and-architecture-review.md)

## 实现

- PWA：
  - `web/public/manifest.webmanifest`（standalone、theme/background、SVG maskable icon）；
  - `web/public/icon.svg`；
  - `web/public/sw.js`：network-first shell cache，跳过非 GET、`/api/`、`/_matrix/` 和跨域；
  - 仅生产构建注册 service worker；
  - `index.html` 增加 manifest/icon/description/apple meta；
  - 静态服务补 `.webmanifest` MIME。
- 首次引导：
  - 空会话页列出 4 步：创建 agent、私聊/群聊 @、agent 自判 PASS、intake 需求顾问。
- 可访问性：
  - toast 加 `aria-live="polite"`（已有 `role=status`）；
  - 保留已有 `prefers-reduced-motion` 全局关闭动画/过渡；
  - modal 已有 `role=dialog`/focus trap。

## 验证

- `dist/manifest.webmanifest`、`dist/sw.js`、`dist/icon.svg` 构建产物存在；
- 三个 URL 均 200；sw 为 `text/javascript`，icon 为 `image/svg+xml`；
- manifest 原先 `application/octet-stream`，已补 `application/manifest+json`；
- lint/build 通过；43 tests。

## 边界

- 只缓存 shell/静态资源；离线时没有数据/消息，仍必须本地 server + Tuwunel。
- 没有 background sync、push、离线队列。
- 只有 SVG icon；部分 iOS/Android 安装要求 PNG 192/512，未提供。
- 没有跑 Lighthouse/axe，也没有移动端真机测试。
- 首次引导只是静态步骤，不是交互式 wizard；没有 onboarding 进度持久化。
