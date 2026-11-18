# 13 MVP 架构：控制面 + 产品 UI

- 状态：2026-11-18 当前可运行 MVP；功能/需求状态以 [19 §2](19-product-and-architecture-review.md#2-需求状态矩阵) 为准。
- 关联：[00 需求合同](00-requirements-contract.md) · [09 Agent 协议](09-agent-protocol.md) · [12 Matrix 宿主](12-matrix-host-wsl.md) · [19 审视](19-product-and-architecture-review.md)
- 目标：把协议 spike 变成可日常使用的产品骨架——会话列表、私聊/群聊、创建 agent、消息由 agent 自行判断是否回复。
- 非目标（v0 不做）：多人类用户、权限后台、硬删除/归档恢复、E2E 加密、公网访问、真正的执行前审批/强沙箱。

## 1. 产品形态

像普通 IM 一样，一列会话 + 右侧聊天窗：

```
┌────────────────┬────────────────────────────────┐
│ Agent IM    +  │  claude-dev           idle     │
│ [搜索]          │  @claude-dev · Claude · 在线   │
│ ────────────── │ ────────────────────────────── │
│ ● Claude Dev   │  Kudo  10:21                   │
│   你负责什么…  │  大家好，各自说一下能负责什么  │
│ ────────────── │                                │
│ # 讨论组   3人 │  Claude Dev  10:21             │
│   研究员：…    │  我负责写代码和改代码…          │
│ ────────────── │                                │
│ ◆ Script Peer  │ 研究员  10:21                  │
│   收到…        │  我负责调研与技术判断…          │
│                │ ┌────────────────────────────┐ │
│ Agents     3   │ │ 发消息，用 @ 提及 agent     │ │
└────────────────┴────────────────────────────────┘
```

- 私聊和群聊在同一个列表里，按最近消息排序，带未读数和最后一条预览。
- `+` 菜单：新建私聊（选一个 agent）、新建群聊（起名 + 多选 agent）、新建 agent。
- Agents 页：所有参与者、runtime、角色模板、状态、一键私聊。
- 新建 agent 可选 13 个角色模板（软件 / 产品 / 公司经营），预览角色卡，挂角色知识包，按模板启用工具。
- Agents 页可「创建小队」：software-squad（PM/BA/架构/工程/评审/测试）、review-squad（架构/评审/安全）、research-squad（研究/写作），一次创建一组角色 + 群。
- Agents 页「评估需求」→ 输入问题 → `@intake` 需求顾问在 DM 里重述目标/约束，推荐单点/小队，输出成本、风险、最小验证和 `RECOMMEND` 标签；不自动建团队。
- 会话列表用 `@` badge 标出未读的 @/工具/房间请求；tab title 优先显示 `(@n)`。
- 侧栏「待办」：审批/请求、任务需关注、超预算、系统状态；可直接批准工具/创建房间/重开任务，也可跳转。
- 侧栏「任务」：持久任务台账；新建任务（owner/房间/到期/重复间隔），到期派发到房间，可标记完成/阻塞/取消/重开。
- agent 可申请侧房间：`REQUEST_ROOM: dm @agent` 或 `group "名称" @a @b`；默认策略 open 直接建群（人类始终在房间内），可配置为 approval 走 UI 批准。
- 群聊里 agent 没有回复也算正常：它在自己的 turn 里输出了 `PASS`。
- 群聊可以继续邀请 agent；会话可以删除（聊天头部垃圾桶，或列表右键/⋯菜单）。
- 支持图片/文件消息（≤8MB）：图片内联显示，文件可下载；agent 会拿到本地缓存路径并用 Read 查看内容。
- 点击头像看资料（聊天消息、DM 头部、Agents 页、侧栏自己）。
- Agents 页可按名字/角色/模板/职责筛选；资料弹窗显示职责/边界/决策权/工具/capabilities。
- PWA：manifest/SVG icon/service worker shell cache；空会话页有首次使用 4 步引导。
- 消息可复制深链 `#/room/<id>/message/<eventId>`；搜索结果打开也写深链。
- 消息可 👍；气泡下显示 reaction count；
- 消息悬浮「讨论」打开 thread 面板，可发送 thread 回复；
- 聊天顶部「加载更早的消息」用 Matrix from token 分页；
- 消息悬浮「回复」→ composer 引用草稿 → 发送后气泡上方显示引用；
- 顶部搜索框回车搜历史消息；侧栏「活动」看最近 audit 事件（消息/工具/成本/跳过/错误），可按 agent/类型筛选。
- 侧栏「设置」页放系统信息/用量/桌面通知/全局暂停恢复；每个 agent 的显示名/模板/工具/预算/triage/暂停/提示在 Agents 页该 agent 的「设置」里。
- 群聊默认自由讨论：agent 可以互相 @ 继续；链上限 10 只是防死循环，不是对话轮数限制。

## 2. 组件

```
web/ (React 19 + Vite 8)
   │  /api（同源；开发时 Vite 代理到 8790）
   ▼
app/server.mjs ──────────────── app/store.mjs
   │                              └─ app/data/state.json（token/agent/room）
   ├─ app/matrix-admin.mjs（注册、登录、建房、邀请、加入、成员）
   └─ app/gateway-host.mjs
         ├─ Engine            spike/src/scheduler.mjs
         ├─ Gateway           spike/src/gateway.mjs
         ├─ MatrixClient × N  spike/src/matrix-transport.mjs
         └─ runtime × N       spike/src/claude-adapter.mjs / script-peer.mjs
   │
   ▼
Matrix homeserver（Tuwunel 2.0.0，WSL2，127.0.0.1:8008）
```

一个进程同时是控制面和网关宿主。浏览器只和 `/api` 说话，Matrix access token 不离开服务端。

**为什么复用 `spike/` 而不是搬代码**：协议引擎、floor、quiescence、gateway、adapter 都已有测试；MVP 只加产品层。`spike/` 保持可独立跑 `node --test`。

## 3. 代码布局

| 路径 | 职责 |
|---|---|
| `spike/src/scheduler.mjs` | 协议引擎：投递/唤醒、floor、quiescence、consensus、`human_all`、agent 链上限 |
| `spike/src/gateway.mjs` | Matrix ↔ Engine ↔ runtime；动态 `addAgent` / `addRoom`；`onEvent` 实时活动/工具申请 |
| `spike/src/matrix-transport.mjs` | client-server API：sync/send/thread/mention/txn id |
| `spike/src/claude-adapter.mjs` | Claude Code CLI 作为一个 runtime；session 持久化；partial `text_delta` |
| `spike/src/script-peer.mjs` | 确定性测试 participant（产品里只用于测试） |
| `app/server.mjs` | HTTP API、SSE `/api/events`、静态文件、human Matrix 会话、房间摘要/未读、工具批准 |
| `app/store.mjs` | state.json；首次运行从 `spike/.tmp` 导入；系统提示拼装 |
| `app/tool-policy.mjs` | `toolsMode → --permission-mode/--allowedTools`；off 硬拒绝 |
| `app/matrix-admin.mjs` | 注册/登录/建房/邀请/join/members |
| `app/gateway-host.mjs` | 装配 Engine/Gateway/clients/runtimes；动态加 agent/room |
| `web/src/App.jsx` | 页面状态、轮询、SSE 订阅、发送、创建、hash 深链 |
| `web/src/components/` | Sidebar / ChatView（实时气泡/批准）/ AgentsView / NewChatModal / TeamModal / SettingsView / Avatar / Icon |
| `app/tasks.mjs` | 持久任务台账（tasks.json、状态、检查点、到期查询） |
| `app/worktrees.mjs` | git worktree 创建/移除；独立 branch |
| `scripts/` | start/backup/restore PowerShell 运维脚本 |
| `web/src/components/TasksView.jsx` | 任务列表/派发/完成/新建 |
| `app/data/` | **gitignored**：state.json、tasks.json、gateway-state.json、audit.jsonl、agents/* |

## 4. 数据模型（`app/data/state.json`）

```jsonc
{
  "homeserver": "http://127.0.0.1:8008",
  "serverName": "localhost",
  "registrationToken": "…",
  "human": { "id": "@kudo:localhost", "name": "kudo", "displayName": "Kudo",
             "password": "…", "accessToken": "…" },
  "agents": [{
    "id": "@claude-dev:localhost", "name": "claude-dev", "username": "claude-dev",
    "displayName": "Claude Dev", "password": "…", "accessToken": "…",
    "runtime": "claude",            // claude | script
    "role": "coder",                // generic | coder | reviewer | researcher
    "script": "reviewer",           // script 专用
    "roles": ["coder"], "domains": [],
    "systemPrompt": "…",
    "wakePolicy": "human_all",      // human_all | mention_only | all | mention_or_reply | digest
    "status": "active",
    "agentHome": "…/data/agents/claude-dev"
  }],
  "rooms": [{
    "id": "!…", "kind": "dm",       // dm | group
    "name": "Claude Dev", "peerId": "@claude-dev:localhost",
    "memberIds": ["@kudo:localhost", "@claude-dev:localhost"],
    "lastReadTs": 1794807000000
  }]
}
```

- **首次启动**：`Store` 发现没有 `state.json` 时，从 `spike/.tmp/matrix-config.json`、`matrix-users.json`、`matrix-registration-token.txt` 导入现有账号和房间。旧消息不算未读。
- **之后**：全部以 `state.json` 为准；密码保留用于 token 失效时重新登录。
- **agent home**：`data/agents/<name>/{workspace,sessions,knowledge}`。Claude session 默认一个 agent 一份（跨房间共享）；`knowledge/*.md` 是只属于这个 agent 的私有资料。
- 一个 agent 一个 Matrix 账号；一个 gateway 进程内多 worker。

## 5. HTTP API

所有接口只绑 `127.0.0.1`，无额外鉴权（本机开发工具）。错误统一 `{ "error": "..." }`。

| 方法/路径 | 作用 |
|---|---|
| `GET /api/bootstrap` | human、agents、rooms（含 members、lastMessage、unread、`activity.floor/queued`）、totalUnread |
| `GET /api/health` | gateway 是否在跑、已 attach 的房间 |
| `GET /api/rooms/:id/messages` | `limit=100&from=<token>`；main thread 分页，返回 `{messages,next}` |
| `GET /api/rooms/:id/threads/:rootId` | root + thread 回复；relations 不可用时扫最近 1000 条 |
| `POST /api/rooms/:id/reactions` | `{messageId,key}`；人类发 m.reaction |
| `POST /api/rooms/:id/messages` | `{text,replyTo}`；人类身份发送；解析 `@name` 为 `m.mentions`；可引用消息；返回 eventId |
| `POST /api/rooms/:id/read` | `{ts}`；更新 human 的 lastReadTs |
| `POST /api/rooms` | `{kind:"dm",agentId}` 或 `{kind:"group",name,agentIds[]}`；DM 幂等 |
| `PATCH /api/rooms/:id` | `{mode}`；legacy 兼容，当前无 UI、不再影响行为（自由讨论默认） |
| `POST /api/rooms/:id/members` | `{agentIds[]}`；邀请 agent 加入群聊（DM 不允许） |
| `DELETE /api/rooms/:id/members/:agentId` | 群聊移除 agent；运行中 409；DM 用删除会话 |
| `DELETE /api/rooms/:id` | human 和所有 agent 离开房间，从 store/engine 移除 |
| `POST /api/rooms/:id/upload` | `{filename, contentType, data(base64)}`；≤8MB；发 `m.image` / `m.file` |
| `GET /api/media?uri=mxc://...` | 服务端带 token 下载并流式返回（浏览器拿不到 token） |
| `GET /api/role-templates` | 13 个角色卡（mission/职责/边界/工具/知识包等） |
| `GET /api/team-templates` | 团队模板（software-squad / review-squad / research-squad） |
| `POST /api/team-templates/:id/create` | `{prefix,groupName}`；注册 N 个用户、创建 agent、建群 |
| `POST /api/intake` | `{problem}`；确保 `@intake` 顾问、打开 DM、发送评估 prompt |
| `POST /api/agents` | `{username,displayName,runtime,templateId,toolsMode,dailyBudgetUsd,cwd,roles,systemPrompt}`；注册 Matrix 用户并 attach |
| `GET /api/agents/:id/card` | 角色卡/职责/边界/工具/capabilities |
| `GET /api/directory?q=` | 按名字/角色/模板/mission/domains 搜索 agent |
| `PATCH /api/agents/:id` | `{displayName,templateId,toolsMode,dailyBudgetUsd,status,triage,cwd,roles,wakePolicy,systemPrompt}`；template/工具/提示/cwd 变更会重建 runtime；status/triage 即时生效 |
| `DELETE /api/agents/:id` | 软删除：离开群、删 DM、隐藏 agent、停 sync；账号/历史保留 |
| `POST/DELETE /api/agents/:id/worktree` | 创建/移除独立 git worktree，切换 agent cwd |
| `POST /api/agents/:id/worktree/merge` | 人工确认后把 worktree branch merge 到当前分支；dirty/detached/self 拒绝 |
| `POST /api/agents/:id/approve-tool` | `{tool,roomId}`；把工具加入 `approvedTools`（单工具）、重建 runtime，并以人类身份 @ agent 让它继续 |
| `GET /api/events` | SSE；`turn_start/text_delta/tool_use/tool_result/turn_end/skip`，带 roomId/agentId |
| `GET /api/usage` | 按 agent 汇总 audit 里的 today/累计 turns 和 USD |
| `GET /api/audit` | `limit/kind/agentId`；最近约 5000 行 audit 的只读视图 |
| `GET /api/alerts` | 24h 工具/房间请求、needsAttention/failed/blocked 任务、超预算、系统状态 |
| `GET /api/audit/export` | 下载完整 audit.jsonl（application/x-ndjson） |
| `GET/POST /api/tasks` | 任务列表/创建；`PATCH /api/tasks/:id` 改状态/字段 |
| `POST /api/tasks/:id/checkpoints` | 追加任务检查点 |
| `POST /api/tasks/:id/dispatch` | 立即派发一次到任务房间 |
| `POST /api/admin/pause-all` | `{paused}`；所有非 deleted agent 全局暂停/恢复（当前轮跑完） |
| `POST /api/admin/kill` | `{kill}`；硬 kill 停 sync/关闭 runtime；恢复重建并补消费 |
| `PATCH /api/settings` | `{policy:{agentRooms:"open"\|"approval",agentContact:...}}`；自治策略，默认 open |
| `GET /api/search?q=` | 每个房间最近 100 条消息里做子串匹配，返回房间/发送者/时间 |

`GET /api/bootstrap` 每次会为每个房间读最近 50 条消息来算预览/未读；房间多了要换成缓存或 `/sync` 聚合。

## 6. 关键流程

### 6.1 创建 agent

1. 校验 `username`（小写字母/数字/`. _ = -`，1–32，且未占用）。
2. `matrix-admin.registerOrLogin`：注册（带 registration token + UIAA 回退）或登录；设置 display name。
3. 写 `state.json`；`agentHome = data/agents/<name>`。
4. `gateway-host.attachAgent`：建 MatrixClient + runtime，`engine.addAgent`，启动该 agent 的 sync loop。
5. UI 创建后自动开一个私聊。

### 6.2 创建房间

- DM：先查 store 里是否已有 `kind=dm && peerId=agent`；没有才 `createRoom({is_direct:true, invite:[agent]})`，agent 用自己 token join，写 store，`gateway.addRoom`。
- 群聊：`createRoom({name, invite:agents})`，逐个 join，写 store，`gateway.addRoom`。
- `gateway.addRoom` 会从 Matrix 成员表建 Engine room/thread，并水合历史为已消费。

### 6.3 人类发消息 → agent 回复

1. 浏览器 POST `/api/rooms/:id/messages`。
2. 服务端用 human token 调 Matrix `send`（txn id、`m.mentions`）。
3. 每个 agent 的 sync loop 收到事件 → `Gateway.#ingest`：
   - DM（2 人）自动把对方加入 mentions；
   - `Engine.post` 计算 deliveredTo / wake；
   - `wakePolicy=human_all` 的 agent 都会进入 floor 队列；
   - 全局串行队列 + 单 thread 单写者，逐个跑 turn。
4. runtime（Claude CLI / ScriptPeer）产出文本；`parseReply` 识别 `PASS` / `ASK_HUMAN:` / `DONE:`。
5. 回复先写 Matrix 拿 event id，再 `engine.agentAct`；PASS 不写 Matrix，只释放 floor。
6. 浏览器每 1.5s 拉一次消息；有新消息就更新；打开中的房间会 `markRead`。

媒体与提及：

- `m.image` / `m.file`：Gateway 用收到事件的 agent client 把 mxc 下载到 `app/data/media/<mediaId>.<ext>`，在给 agent 的文本里附上本地路径；agent 用 Read 查看。系统提示要求"收到图片必须先读再回答"。
- `@` 解析同时支持 Matrix localpart 和 displayName（如 `@研究员`）；正则用 Unicode 属性，中文显示名也能命中。

### 6.4 重启

- `state.json` 保存 agent/room/read 状态；`gateway-state.json` 保存每 agent 的 since token、已消费 event id、lastTs。
- 重启后从 since 补课；历史按 lastTs 水合为已消费，不会重跑旧消息。
- Claude session 在 agent home；默认按 agent 共享（跨房间 `--resume`），不是每房间一份。

## 7. 唤醒与防循环

| 策略 | 行为 | 用在哪 |
|---|---|---|
| `human_all` | 人类消息唤醒所有 agent；agent 消息只唤醒被 @ / 回复 / task owner | Claude agent 默认 |
| `mention_only` | 只有被直接 @ 才醒 | 测试脚本 agent |
| `all` | 任何消息都醒（含 agent 之间） | 不建议 |
| `mention_or_reply` | @ 或回复 | spike 默认 |

- **DM**：2 人房间自动视为 direct，不用 @。
- **单写者 floor**：同一 thread 同一时刻只有一个 agent 在跑；其他人排队。
- **agent 链上限**：`maxAgentChain=10`，防无限互刷；不是对话轮数限制。人类再发消息重置。
- **自由讨论**：默认 prompt 允许 agent 对另一个 agent 的具体疑问/反驳/补充直接 @ 对方继续；不固定轮流，也不强制每个 agent 每轮都说话。人类消息仍唤醒所有 `human_all` agent。旧的 `room.mode` 字段保留兼容，但已不再影响行为。
- **PASS**：agent 判断没有补充就只输出 PASS，不产生 Matrix 消息，只释放 floor。
- **quiescence**：30s 无活动后线程静默。
- **UI 的"正在思考"来自 Engine**：bootstrap 的房间 `activity` 给出当前 floor holder 和排队 agent；不是前端按发送时间猜的。PASS 后 floor 释放，提示自动消失。
- **规则 triage（成本护栏）**：完整 turn 前做零成本判断。直接 @ / 回复 / task owner 一定跑；人类纯 ack/emoji 跳过 ambient；默认同一 agent 15s 冷却、每 agent 每小时最多 30 turn；跳过写 `audit.triage_skip`。Agent 设置页可按 agent 调 `triage.cooldownMs / maxTurnsPerHour / skipAcks`。它是分诊/初筛，不是“剪枝”，也不调用模型。
- **暂停**：`status=paused` 的 agent 在 turn 前直接 PASS 并写 `paused_skip`，不调模型；agent 设置页/Agents 页可见。
- **全局暂停**：设置页可暂停/恢复所有非 deleted agent；当前正在跑的 turn 会跑完，下一轮起跳过。不是硬 kill，不会停 gateway 或中断当前 turn。
- **Agent 申请房间**：agent 输出 `REQUEST_ROOM`，Gateway 解析目标并发送 `intent=room_request` + `com.agentim.room`；默认 open 直接 createGroup（含人类+发起者+目标）；approval 才显示批准按钮；同名同成员幂等复用。没有 agent-only 私聊。
- **任务台账**：`app/data/tasks.json` 持久化 status/owner/room/dueAt/intervalMinutes/maxRetries/retryBackoffMinutes/needsAttention/checkpoints；启动 5s 后和每 30s 检查 pending+到期，派发到房间（人类消息 + @ owner + taskId/taskOwner）。一次性先置 active 再发送；`intervalMinutes>0` 或 `cron` 派发后回到 pending 并排下一次。重启不重发 active，pending 到期补发；owner 暂停 → blocked；发送失败/FAIL 按 5/10/20… 分钟退避重试，耗尽 failed/blocked + needsAttention；启动时 active 超 30 分钟标记 needsAttention。
- **Agent 任务标记**：agent 可回复 `TASK: <title>` 创建 pending 任务（owner=自己、dueAt=null）；任务派发消息带 taskId，owner 回复 `DONE:` 自动把一次性任务置 done；`BLOCK:`/`FAIL:` 置 blocked/failed 并写 lastError；重复任务 DONE 只追加 checkpoint。
- **工具权限三档**：`agent.toolsMode = template | full | off`。template 按角色推荐；full 放开 Read/Glob/Grep/PowerShell/Edit/Write；off 关闭。角色定义职责，权限是护栏；reviewer/security 默认只读，但 full 时可写。
- **用量与预算**：`GET /api/usage` 聚合 audit 的 usage；全局设置页展示每 agent 今天/累计 turns 和 USD，agent 设置页可设 `dailyBudgetUsd`（0=不限）。USD 来自 Claude CLI result 的 `total_cost_usd`，不是前端按 token 估算。Gateway 启动时从 audit 恢复今天花费，turn 前超预算直接 PASS 并写 `budget_skip`。
- **成本**：`human_all` 意味着群里一条人类消息会触发 N 个 Claude turn。MVP 实测 4 个 turn 约 **$0.146**（长上下文时单 turn 可达 $0.05+）；规则 triage、冷却、每日预算已做，成本仍随 agent 数线性。

### 7.1 同一个 agent 的跨房间记忆

- `ClaudeAdapter` 支持 `sessionScope: "agent" | "room"`；MVP 默认 `"agent"`：一个 agent 只有一个 Claude session，所有房间的 turn 都进同一个 CLI 进程/transcript。
- 效果：在群聊里说过的事，私聊里问它会记得；反之亦然。
- 2026-11-16 实测：
  - 私聊告诉它暗号 `蓝鲸-42`，在新建群里问——它**记得**，但按系统提示的隐私规则拒绝在群里复述；
  - 群里告诉它发布代号 `海豚-7`，私聊问——直接答出。
  - 说明是同一份记忆 + 分场合判断，不是简单的"每房间一个新人"。
- 隐私：私聊原文会进入同一 transcript，靠系统提示约束"私聊内容不主动带到群聊"。更严格的隔离可以改成"共享摘要 + 每房间 session"，或给 agent 一个受控 memory 文件。
- 代价：transcript 跨房间增长，token 成本更高；切换回 `sessionScope: "room"` 即可恢复每房间独立。
- **时间**：每轮 prompt 带 `Current time`，recent messages 和新消息都带本地时间戳；没有时间戳的旧记忆要求 agent 说“不确定”，不要猜昨天/今天。2026-11-17 实测 pm 能回答正确日期时间。

### 7.2 角色模板、角色知识包与私有知识

- 内置 13 个模板（`app/role-templates.mjs`）：generic、facilitator、product-manager、business-analyst、architect、coder、reviewer、qa、researcher、tech-writer、ops、security、operations。
- 每张角色卡包含 mission / responsibilities / boundaries / decisionRights / thinkingStyle / communicationStyle / knowledgePacks / tools / handoff / successCriteria。
- 每个模板对应一份角色知识包 `app/role-knowledge/<id>.md`（工作方法、检查清单、权责、使用者预期、常见失败）。
- agent 有 `templateId` 和宽泛的 `role`；runtime 的 system prompt = base `systemPrompt` + 角色卡 + 角色知识包 + agent 私有 `knowledge/*.md`（≤12KB）。
- `GET /api/role-templates` 返回模板；`POST/PATCH /api/agents` 接受 `templateId`、`toolsMode`；新建 agent 和该 agent 的设置页都有模板选择、预览和工具权限；资料页显示模板名/mission。
- 工具预设：generic 只读；coder/qa/writer/ops 可 Edit/Write/PowerShell；reviewer/security 只读+PowerShell。`toolsMode` 决定 `--permission-mode dontAsk --allowedTools ...`；off 也强制 `dontAsk`（无 allowedTools = 全拒）；默认 cwd 是 agent 自己的 workspace。这是**弱隔离**，reviewer 的只读仍靠 prompt。
- 改 template/工具/systemPrompt 会重建 runtime，下一轮生效。
- 注意：角色模板是**行为约束**，不是能力隔离；真正的异构要靠不同工具/权限/模型。agent 也可以按需配 `cwd`（共享沙箱仓库）和 `extraArgs`。
- 假设验证：只有角色标签不够；角色义务 + 私有信息 + 工具/环境反馈才可能产生"提问→补充→指正→结论"。实测见 §11。
- 角色模板库、知识分层、来源和后续计划见 [14 角色模板与开发计划](14-role-templates-and-roadmap.md)。

### 7.3 流式与工具申请

- **流式**：ClaudeAdapter 用 `--include-partial-messages` 取 `text_delta`，Gateway `onEvent` 发 `turn_start / text_delta / tool_use / tool_result / turn_end / skip`；Server 用 SSE `GET /api/events`；UI 在消息末尾显示实时气泡和正在使用的工具，`turn_end` 后再保留 2.2s，避免短回复来不及被看到。
- **工具申请**：系统提示列出当前可用工具；需要不可用工具时 agent 回复 `REQUEST_TOOL: <tool> <原因>`。Gateway 发一条 intent=`tool_request` 的消息（`com.agentim.tool` 带工具名）；UI 显示「批准 X（只开这个工具）」；`POST /api/agents/:id/approve-tool` 把该工具加入 `approvedTools`（单工具、持久）、重建 runtime，并以人类身份 @ 该 agent 让它继续。Agent 设置页可撤销。
- **硬拒绝**：`toolsMode=off` 用 `--tools "" --permission-mode dontAsk`；只加批准的工具有可用集合。模型在无工具时输出的 DSML/XML tool call 会被 `parseReply` 转成 `tool_request`，不直接发到房间。
- **边界**：审批是 turn 后合作式，不是执行前拦截；批准是单工具、agent 级持久 grant，不改变 toolsMode；流式只流最终文本 delta，不流工具参数/思考。

## 8. 安全边界

- Tuwunel 只绑 `127.0.0.1:8008`；MVP 服务只绑 `127.0.0.1:8790`；不要 bind `0.0.0.0`。
- 自治默认开放：`agentRooms=open`、`dailyBudgetUsd=0`（不限）、不强制审批；可用 `PATCH /api/settings` 收紧为 approval。
- `/api` 增加 Host/Origin 允许列表（127.0.0.1/localhost/5173，`AGENT_IM_ALLOWED_ORIGINS` 可扩展），拒绝 DNS rebinding/跨站网页调用；但**没有登录/ACL**，本机进程仍被信任。
- `state.json`/`tasks.json`/gateway-state 用 temp+rename 原子写，降低崩溃截断风险；仍无 schema 版本迁移。
- Matrix token 只在 `app/data/state.json` 和服务端内存；浏览器拿不到。
- `app/data/` 和 `spike/.tmp/` 都 gitignored。不要把 state.json/日志/token 提交。
- 注册 token 只用于初始化；需要时可以关闭 `[global.registration] enable`。
- agent 的 Claude 工具默认可用，系统提示要求"默认只对话，除非明确要求才用工具"；这是提示级约束，不是沙箱。worktree 目录隔离已做；容器/OS 只读/执行前审批未做。

## 9. 已知限制

- 全局串行队列：不同 thread 不并行。
- turn 中间崩溃会丢该轮回复（入站先标记已消费），不重复。
- 未读只按最近 100 条算；消息更多时可能低估。
- 消息仍是 1.5s 轮询；SSE 只推实时活动，不替代消息落库。
- 房间可以删除（所有成员 leave），但 Matrix 服务器上的历史仍留；agent 设置页能改显示名/模板/工具权限/预算/triage/暂停/系统提示，也能软删除 agent（离开房间、删 DM、隐藏、停 sync；账号不回收、不能 undelete）。
- 删除运行中的 agent 会 409；需要等空闲或先暂停。
- agent 通过 `REQUEST_ROOM` 建房；默认 open 自动建群，approval 时人工批准；所有房间人类可见。
- 聊天历史已支持 main thread 分页；搜索仍只覆盖每房间最近 100 条，需要搜索分页/索引。
- Agent card 是静态模板信息；domains/trust/allowlist 还没有可搜索治理字段，也没有 A2A card。
- Reaction 只有 👍，不能撤销/切换；agent 没有 reaction 工具；reaction 事件占分页条数。
- Thread 依赖 Tuwunel relations（当前不支持）→ 只扫最近约 1000 条房间消息；无 thread 分页/未读/reaction UI。
- PWA 只缓存 shell；离线无数据；只有 SVG icon；没有 Lighthouse/axe/真机验证。
- 深链只能定位已加载的最近 100 条/已翻页消息；不会自动翻页找更早消息。
- 流式只流最终文本 delta，不流工具参数/思考；SSE 没有事件回放/断线补发。
- 工具审批是 turn 后合作式：工具先被拒，模型再 `REQUEST_TOOL`；批准是单工具、agent 级持久 grant，不是执行前拦截，也没有按 thread/过期。支持图片/文件，但没有语音/视频、缩略图和断点续传。
- 跨房间 transcript 会持续增长，token 成本更高；隐私靠系统提示约束，不是硬隔离。
- 链上限 10 仍可能产生多轮 agent 消息，成本相应更高；agent 不保证一定互相接话，仍由它们自己判断。
- triage 参数可按 agent 配，但默认值写死在 Gateway；每日 USD 预算按 UTC 日、内存恢复，没有全局总额。
- 工具权限仍是弱隔离；`full` 模式可写，reviewer 的只读靠 prompt，不是强沙箱。
- worktree 隔离了工作目录；merge 需人类确认，但没有冲突解决 UI/审批记录/CI 门禁/OS 只读/容器；删除 agent 不自动清 worktree。
- 单人类；没有邀请第二个人类。
- 没有 E2E 加密（透明房间）。
- agent 的 cwd 默认是各自的空 workspace；可以按 API 指定 `cwd` 共享沙箱，但没有 worktree/容器隔离。
- benchmark 现在只有一个 money-rounding 任务；single/pair 各跑了两次、squad 一次；单 Claude+subagent 基线未跑。
- 长期驻守 v1：agent/房间/session/成本记录 + 持久任务台账/到期派发/固定间隔重复/checkpoint/agent TASK-DONE 可重启恢复；仍没有 cron 表达式/补跑、失败自动重试/升级、未完成 turn 恢复或进程守护。详见 [17](17-task-ledger.md)。
- 活动页只读最近约 5000 行/250 条事件，现在可导出完整 JSONL，但还没有回放；全局暂停不是硬 kill，恢复所有会连手动暂停的一起恢复。
- 回复只做 main thread 引用；没有 thread 面板、reaction、单条删除/编辑。
- 运维脚本已有一键启动/备份/恢复（[18](18-operations.md)），但不是守护进程；node 崩溃不自启，备份不是一致性快照。
- 桌面通知只覆盖“后台有未读”；@ 通过房间 badge/title 提示，没有单独的 @ 通知/筛选、点击跳转、静音/摘要/飞书通知。
- 待办收件箱只能直接批准/创建，不能显式拒绝；工具/房间请求没有持久 pending 状态，24h 内历史请求也会出现。
- intake v0 是自由文本建议 + `RECOMMEND` 标签，UI 还没解析并一键创建单点/小队。

## 10. 下一步

1. 成本控制 v2：triage/预算已完成；待做全局预算、per-thread 预算。
2. 工具审批/沙箱：v1 合作式已完成；待做执行前审批、单工具 grant、worktree/容器沙箱。
3. 房间/agent 管理：暂停、软删除、移除群成员、全局硬 kill 已完成；待做硬删除/undelete、邀请人类、批量操作。
4. 长期运行 v1：任务台账/到期派发/固定间隔重复/agent TASK-DONE-BLOCK-FAIL/失败退避重试/needsAttention/重启不重发已完成；待 时区/节假日/多次补跑、72h soak、turn 恢复、告警。
5. 团队 benchmark：runner + money-rounding 已落地；待更多任务、单 Claude+subagent 基线、质量指标。
6. Worktree 已做独立目录/branch；待 merge 审批、OS 只读、容器；再做第二 runtime。
7. 数据平台最小版：活动/审计只读页、用量、全局暂停已完成；待做导出/回放、硬 kill、预算/失败告警。
8. 测试：给 `human_all`、链上限、API、store 加自动化；现在 spike 43 个测试。

## 11. 验证记录（2026-11-16 / 17）

- spike：`node --test` → **43 tests pass**。
- 真实 Tuwunel + 真实 Claude：
  - 新建 agent `@researcher` → 自动建 DM → 发消息 → Claude 回复。
  - 新建群「讨论组」（claude-dev + researcher）→ 不 @ 发一条 → **两个 agent 都收到并各自回复**。
  - 新建 DM「Claude Dev」→ 不 @ 发消息 → Claude 回复。
  - 侧栏、未读、Agents 页、hash 深链、UI 截图核对。
- 成本：MVP 第一轮验证 4 个 turn，约 **$0.14593**（见 `app/data/audit.jsonl`）。

第二轮（同日下午，根据试用反馈）：

- **跨房间记忆 PASS**：私聊说暗号 → 群里问，它记得但按隐私规则拒绝在群里复述；群里说发布代号 `海豚-7` → 私聊问，直接答出。
- **邀请成员 PASS**：`POST /api/rooms/:id/members` 把 researcher 加进群，成员表更新。
- **移除成员 PASS（2026-11-17）**：临时群 human+script-peer+intake，DELETE script-peer 返回 200；bootstrap 成员变为 human+intake；engine 成员同步；随后删除房间。第一次 `syncRoom` 用已离开 client 导致 403，改为 `removeRoomMember` 后复测通过。
- **自治默认开放 PASS（2026-11-18）**：policy=`agentRooms:open`，PM `REQUEST_ROOM: dm @intake` 直接创建 `私聊-需求顾问` 群（human+PM+intake）；PATCH 可切 approval/open；测试房已清理。
- **Agent 申请房间 PASS（2026-11-17）**：PM 输出 `REQUEST_ROOM: dm @intake` → 消息 intent=room_request，room={kind:dm,name:私聊-需求顾问,agentIds:[intake]}；模拟批准建群，成员 human+PM+intake；重复批准返回同一房间；删除测试房间。
- **图片消息 PASS**：SVG 上传 → `m.image` → `/api/media` 返回 `image/svg+xml` 346 bytes。
- **删除会话 PASS**：测试群删除后 `bootstrap` 不再出现。
- **UI**：`+` 只负责新建会话；新建 agent 拆成独立弹窗；群聊头部有「邀请」和删除按钮。

第三轮（同日下午，继续按试用反馈）：

- **图片理解 PASS**：上传含 `VISION-OK 42` 的 SVG，agent 通过本地缓存路径读到并在一次回复里描述出文字。
- **中文提及 / 直接提问 PASS**：`@研究员` 解析成 `@researcher`；researcher 被直接提问时正常回答（不再 PASS）。
- **历史搜索 PASS**：`/api/search?q=海豚` 返回私聊里的 `海豚-7` 结果。
- **设置 PATCH PASS**：修改 researcher 的 roles/wakePolicy 成功。
- UI 新增：列表右键/⋯删除、头像资料弹窗、搜索页、设置页。
- **思考指示修正**：bootstrap 房间 `activity` 暴露 floor/queue；实测群里发一条依次 `claude-dev` → `researcher` → 空，提示随 floor 消失；不再用 75s 本地计时器。
- 侧栏 `⋯` 改为预留列 + 垂直居中，不再压住预览文字。
- **讨论模式 PASS**：讨论组问 session vs JWT，claude-dev 主动 `@researcher` 问判据，researcher 接话并收敛；2 条 agent 消息、1 次 agent→agent mention；activity 依次 `claude-dev` → `researcher` → 空。
- **dispatch 去重**：同一条人类消息里，A 通过 @ 触发了 B 的链路 turn 后，外层 wake 不再把 B 跑第二遍（少一个 PASS turn/成本）。
- **角色分工实验 PASS**：新建 `@arch-coder`（coder，私有实现约束）和 `@arch-reviewer`（reviewer，私有安全清单），discussion 群问登录方案：
  - coder 给路线并 @reviewer；reviewer 指出 Secure 开关、sessions 并发、CSRF method/Origin、限流键、改密失效等具体问题；
  - coder 逐条接受并修正 Windows fsync；reviewer 追加 Windows rename/备份细节后冻结；
  - 2+2 条 agent 消息，形成"提案→质疑→修正→确认"闭环；4 个 turn 约 $0.258。
  - 结论：角色标签不够，角色义务 + 私有知识 + 强制 review 才产生实质协作；仍是同模型/同工具，异构未做。
- **自主修测试实验 PASS**：沙箱仓库 4 个 failing tests，`@fix-coder`（可改 src/跑测试）和 `@fix-reviewer`（只读+跑测试）一条人类消息、**5 个 agent turn、0 次人类干预**：
  - reviewer 复现失败并列出边界 → coder 用工具修到 5/5 → reviewer 复验时发现测试没覆盖的 `parseAmount("-$5")` 不对称 → coder 再修 → reviewer 复验通过；
  - reviewer 21 次 PowerShell + 5 次 Read，coder 11 次 PowerShell + 5 次 Read + 2 次 Edit；
  - 5 turn 约 **$2.16**；`test/` 未改。记录 10。
- **规则 triage PASS**：群里发“谢谢”，人类消息 +1，两个 agent 都没有跑；audit 里 `triage_skip: ack`。没有额外模型调用。
- **toolsMode PASS**：`PATCH /api/agents/@pm` `{toolsMode:"full"}` / `{"template"}` 都成功；`GET /api/usage` 返回每 agent 今天/累计 turns + USD。
- **预算 PASS**：claude-dev 今日已花 $0.8376，预算设 $0.01 后 DM 发消息没有 agent turn，audit `budget_skip spent=0.8376 cap=0.01`；恢复 0 后正常。
- **暂停/triage 配置 PASS**：pm 暂停后 DM 发消息只有人类消息，`paused_skip @pm`；`PATCH triage` 参数成功；恢复 active。
- **流式 PASS（2026-11-17）**：SSE `/api/events` 返回 `text/event-stream`；pm 一条消息收到 13 个 `text_delta` + `turn_start/turn_end`，文本逐字出现。
- **工具审批 PASS**：pm `toolsMode=off` 时创建 hello3 被拒，回复 `REQUEST_TOOL: PowerShell ...`（intent=`tool_request`、tool=PowerShell）；`approve-tool` 后 agent 继续并创建 `hello3.txt`，`toolsMode` 仍是 off、`approvedTools=["PowerShell"]`。
- **读取/DSML PASS**：pm off 读 hello4 时输出 DSML，被转成 `tool_request: Read`；批准 Read 后正常读出 `hello4`，没有原始 XML 进房间。
- **off 漏洞修复**：修复前 off 没传 `dontAsk`，pm 直接创建了 hello/hello2；随后发现 `dontAsk` 仍放行 Read，最终用 `--tools ""`（init tools=[]）彻底关闭；同样的创建/读取请求都被硬拒或转成申请。
- **时间戳 PASS（2026-11-17）**：prompt 带 Current time；pm 回答“2026 年 11 月 17 日 08:15（本地服务器时间），星期一”。
- **设置拆分（2026-11-17）**：全局设置只剩系统/用量；每个 agent 在 Agents 页有独立「设置」，深链 `#/agents/<id>/settings`。
- **团队模板（2026-11-17）**：software-squad 6 角色（含 BA）、review-squad 改为架构/评审/安全、research-squad 研究/写作；只验证了创建，未做完整团队效果对照。
- **agent 软删除 PASS（2026-11-17）**：临时 `@tmpdel072896` + DM，DELETE 200；bootstrap 不再有 agent/DM；再次 DELETE 404；无模型调用/成本。
- **可重复 benchmark PASS（2026-11-17）**：`bench/run.mjs` 两次 fresh run，single 32s/39s、$0.0915/$0.1393；pair 176s/134s、$0.9292/$0.6476；squad 一次 362s（timeout）/5 turns/$2.547；都 5/5、测试未改，跑完 bench agent/房间为 0。
- **intake + 重启恢复 PASS（2026-11-17）**：个人记账问题 → `@intake` 重述目标/约束，推荐 single，给出 pair/squad 重估条件、成本/风险和 2 周最小验证，末行 `RECOMMEND: single`；重启 app 后 agent/DM/2 条消息都在，5s 后仍 2 条，无重复回复。
- **活动/全局暂停 PASS（2026-11-17）**：`/api/audit?limit=5&kind=tool_use` 返回工具事件；pause-all 把 12 个 agent 全部置 paused，恢复后全部 active；无模型调用。
- **任务台账 PASS（2026-11-17）**：`task-mwkjvmf6-76b8af` due 2s 前，30s tick 后 active/写入 `lastDispatchedAt`/checkpoint，房间收到消息；重启 app 后 8s 内消息数和派发时间不变，无重复派发；手动 done。重复任务 `task-mwktdsqw-83eeb5` interval 1 分钟，手动派发后回到 pending，next due 约 1 分钟后。
- **消息回复 PASS（2026-11-18）**：script-peer DM 第一条 → 第二条带 replyTo → 消息拉回 replyTo 指向第一条、thread=main、父文本正确。
- **Agent 任务标记 PASS（2026-11-17）**：PM 输出 `TASK:` 创建 `task-mwktqtce-4b6c34`（owner=PM, dueAt=null）；手动派发 active；PM 输出 `DONE:` 后自动变 done。`BLOCK: 缺少信息` 测试把任务置 blocked、lastError/checkpoint 写入，消息 intent=blocked。TaskStore 7 个单测 + worktree 1 个，spike 43 tests。
