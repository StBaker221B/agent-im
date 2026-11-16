# Agent IM Web

React 19 + Vite 8 的单页产品界面：会话列表、聊天气泡、@ 提及（支持中文显示名）、新建私聊/群聊、独立的新建 agent（13 个角色模板 + 预览 + 工具开关）、创建小队（一次建一组角色 + 群）、SSE 实时输出与工具批准、邀请成员、删除会话（头部/列表右键菜单）、图片/文件消息、头像资料、历史搜索、设置页、Agents 管理。

## 开发

后端先跑起来（`agent-im/app`，默认 8790），然后：

```bash
cd agent-im/web
npm install
npm run dev       # http://127.0.0.1:5173，/api 代理到 8790
npm run build     # 输出 dist/，由 app/server.mjs 直接托管
```

生产形态只需要 `app` 一个进程：`npm run build` 后打开 `http://127.0.0.1:8790`。

## 结构

| 文件 | 作用 |
|---|---|
| `src/App.jsx` | 数据轮询、房间切换、发送、创建、hash 深链、未读 |
| `src/api.js` | `/api` 封装 |
| `src/components/Sidebar.jsx` | 会话列表、搜索、Agents 入口、human |
| `src/components/ChatView.jsx` | 聊天头、消息气泡、@ 自动补全、输入框、思考中 |
| `src/components/AgentsView.jsx` | agent 列表、状态、一键私聊、新建 agent |
| `src/components/NewChatModal.jsx` | 新建会话：私聊 / 群聊（不含建 agent） |
| `src/components/NewAgentModal.jsx` | 新建 agent：角色模板选择、角色卡预览、工具开关、个人补充 |
| `src/components/InviteModal.jsx` | 群聊邀请 agent |
| `src/components/ProfileModal.jsx` | 点击头像看 agent/人类资料 |
| `src/components/SearchView.jsx` | 历史消息搜索与结果跳转 |
| `src/components/SettingsView.jsx` | 系统信息 + agent 参数/模板/工具编辑 |
| `src/components/Avatar.jsx` | 身份色 + 首字头像 |
| `src/format.js` | 颜色、时间、预览、消息分组 |
| `src/styles.css` | 设计 token、深浅色、响应式 |

## 约定

- 浏览器不持有 Matrix token；所有读写走 `/api`。
- 消息按 id 去重合并；发送先乐观插入，轮询后以服务端为准。
- 未读用 `lastReadTs` 在服务端算；打开房间即标记已读（移动端在列表页时不标记）。
- 深链：`#/room/<encoded room id>`、`#/agents`。
- 群聊和私聊在同一个列表；DM 标题取 peer 的 displayName。
- 群聊默认自由讨论：agent 可以互相 @ 继续；不再有「讨论模式」toggle。
- "正在思考/排队中"来自服务端 `room.activity`（Engine 的 floor/queue），不是本地计时器，也不是 Matrix typing；PASS 后 floor 释放会自动消失。
- 新建/设置页的工具权限选择 `template/full/off`；设置页用量表来自 `/api/usage`（今天/累计 turns + USD），每 agent 可设每日 USD 预算、triage 冷却/每小时上限/skipAcks、暂停/启用。
- 聊天订阅 `/api/events`（SSE）：实时显示 token 增量/正在使用的工具；`intent=tool_request` 的消息下有「批准并继续」按钮。

## 设计

- 身份色：kudo 蓝、claude 紫、script 金；其他 agent 按名字哈希。
- 群头像用方形「群」，DM 用对方首字圆形。
- 深浅色跟随系统；窄屏会话列表和聊天窗二选一（返回键）。
- 无障碍：按钮 aria-label、焦点环、`prefers-reduced-motion`、skip link、模态框焦点陷阱（`useDialogFocus`）。
- 按 Web Interface Guidelines 过了一轮：`color-scheme`/`theme-color`、表单 name/autoComplete、touch-action、overscroll、安全区、Intl 时间。
