# 13 MVP 架构：控制面 + 产品 UI

- 状态：2026-11-16 首个可运行 MVP（真实 Matrix + 真实 Claude + 自建网页）。
- 关联：[00 需求合同](00-requirements-contract.md) · [09 Agent 协议](09-agent-protocol.md) · [12 Matrix 宿主](12-matrix-host-wsl.md) · [过程记录 05](records/2026-11-16-05-mvp.md)
- 目标：把协议 spike 变成可日常使用的产品骨架——会话列表、私聊/群聊、创建 agent、消息由 agent 自行判断是否回复。
- 非目标（v0 不做）：多人类用户、权限后台、删除/归档、文件/图片、E2E 加密、公网访问、流式输出、工具审批。

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
- Agents 页可「创建小队」：选 software-squad / review-squad，一次创建一组角色 + 群。
- 群聊里 agent 没有回复也算正常：它在自己的 turn 里输出了 `PASS`。
- 群聊可以继续邀请 agent；会话可以删除（聊天头部垃圾桶，或列表右键/⋯菜单）。
- 支持图片/文件消息（≤8MB）：图片内联显示，文件可下载；agent 会拿到本地缓存路径并用 Read 查看内容。
- 点击头像看资料（聊天消息、DM 头部、Agents 页、侧栏自己）。
- 顶部搜索框回车搜历史消息；侧栏「设置」页管理 agent 显示名/角色/唤醒策略/系统提示。
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
| `app/data/` | **gitignored**：state.json、gateway-state.json、audit.jsonl、agents/* |

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
| `GET /api/rooms/:id/messages` | 最近 60 条 main thread 消息（已过滤撤回空消息） |
| `POST /api/rooms/:id/messages` | `{text}`；人类身份发送；解析 `@name` 为 `m.mentions`；返回 eventId |
| `POST /api/rooms/:id/read` | `{ts}`；更新 human 的 lastReadTs |
| `POST /api/rooms` | `{kind:"dm",agentId}` 或 `{kind:"group",name,agentIds[]}`；DM 幂等 |
| `PATCH /api/rooms/:id` | `{mode}`；legacy 兼容，当前无 UI、不再影响行为（自由讨论默认） |
| `POST /api/rooms/:id/members` | `{agentIds[]}`；邀请 agent 加入群聊（DM 不允许） |
| `DELETE /api/rooms/:id` | human 和所有 agent 离开房间，从 store/engine 移除 |
| `POST /api/rooms/:id/upload` | `{filename, contentType, data(base64)}`；≤8MB；发 `m.image` / `m.file` |
| `GET /api/media?uri=mxc://...` | 服务端带 token 下载并流式返回（浏览器拿不到 token） |
| `GET /api/role-templates` | 13 个角色卡（mission/职责/边界/工具/知识包等） |
| `GET /api/team-templates` | 团队模板（software-squad / review-squad） |
| `POST /api/team-templates/:id/create` | `{prefix,groupName}`；注册 N 个用户、创建 agent、建群 |
| `POST /api/agents` | `{username,displayName,runtime,templateId,toolsMode,dailyBudgetUsd,roles,systemPrompt}`；注册 Matrix 用户并 attach |
| `PATCH /api/agents/:id` | `{displayName,templateId,toolsMode,dailyBudgetUsd,status,triage,roles,wakePolicy,systemPrompt}`；template/工具/提示变更会重建 runtime；status/triage 即时生效 |
| `POST /api/agents/:id/approve-tool` | `{tool,roomId}`；把工具加入 `approvedTools`（单工具）、重建 runtime，并以人类身份 @ agent 让它继续 |
| `GET /api/events` | SSE；`turn_start/text_delta/tool_use/tool_result/turn_end/skip`，带 roomId/agentId |
| `GET /api/usage` | 按 agent 汇总 audit 里的 today/累计 turns 和 USD |
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
- **规则 triage（成本护栏）**：完整 turn 前做零成本判断。直接 @ / 回复 / task owner 一定跑；人类纯 ack/emoji 跳过 ambient；默认同一 agent 15s 冷却、每 agent 每小时最多 30 turn；跳过写 `audit.triage_skip`。设置页可按 agent 调 `triage.cooldownMs / maxTurnsPerHour / skipAcks`。它是分诊/初筛，不是“剪枝”，也不调用模型。
- **暂停**：`status=paused` 的 agent 在 turn 前直接 PASS 并写 `paused_skip`，不调模型；设置页/Agents 页可见。
- **工具权限三档**：`agent.toolsMode = template | full | off`。template 按角色推荐；full 放开 Read/Glob/Grep/PowerShell/Edit/Write；off 关闭。角色定义职责，权限是护栏；reviewer/security 默认只读，但 full 时可写。
- **用量与预算**：`GET /api/usage` 聚合 audit 的 usage；设置页展示每 agent 今天/累计 turns 和 USD，并可设 `dailyBudgetUsd`（0=不限）。Gateway 启动时从 audit 恢复今天花费，turn 前超预算直接 PASS 并写 `budget_skip`。
- **成本**：`human_all` 意味着群里一条人类消息会触发 N 个 Claude turn。MVP 实测 4 个 turn 约 **$0.146**（长上下文时单 turn 可达 $0.05+）。下一轮应加：廉价 triage、每 agent 冷却、每 thread 预算。

### 7.1 同一个 agent 的跨房间记忆

- `ClaudeAdapter` 支持 `sessionScope: "agent" | "room"`；MVP 默认 `"agent"`：一个 agent 只有一个 Claude session，所有房间的 turn 都进同一个 CLI 进程/transcript。
- 效果：在群聊里说过的事，私聊里问它会记得；反之亦然。
- 2026-11-16 实测：
  - 私聊告诉它暗号 `蓝鲸-42`，在新建群里问——它**记得**，但按系统提示的隐私规则拒绝在群里复述；
  - 群里告诉它发布代号 `海豚-7`，私聊问——直接答出。
  - 说明是同一份记忆 + 分场合判断，不是简单的"每房间一个新人"。
- 隐私：私聊原文会进入同一 transcript，靠系统提示约束"私聊内容不主动带到群聊"。更严格的隔离可以改成"共享摘要 + 每房间 session"，或给 agent 一个受控 memory 文件。
- 代价：transcript 跨房间增长，token 成本更高；切换回 `sessionScope: "room"` 即可恢复每房间独立。

### 7.2 角色模板、角色知识包与私有知识

- 内置 13 个模板（`app/role-templates.mjs`）：generic、facilitator、product-manager、business-analyst、architect、coder、reviewer、qa、researcher、tech-writer、ops、security、operations。
- 每张角色卡包含 mission / responsibilities / boundaries / decisionRights / thinkingStyle / communicationStyle / knowledgePacks / tools / handoff / successCriteria。
- 每个模板对应一份角色知识包 `app/role-knowledge/<id>.md`（工作方法、检查清单、权责、使用者预期、常见失败）。
- agent 有 `templateId` 和宽泛的 `role`；runtime 的 system prompt = base `systemPrompt` + 角色卡 + 角色知识包 + agent 私有 `knowledge/*.md`（≤12KB）。
- `GET /api/role-templates` 返回模板；`POST/PATCH /api/agents` 接受 `templateId`、`toolsMode`；设置页/新建 agent 都有模板选择、预览和工具权限；资料页显示模板名/mission。
- 工具预设：generic 只读；coder/qa/writer/ops 可 Edit/Write/PowerShell；reviewer/security 只读+PowerShell。`toolsMode` 决定 `--permission-mode dontAsk --allowedTools ...`；off 也强制 `dontAsk`（无 allowedTools = 全拒）；默认 cwd 是 agent 自己的 workspace。这是**弱隔离**，reviewer 的只读仍靠 prompt。
- 改 template/工具/systemPrompt 会重建 runtime，下一轮生效。
- 注意：角色模板是**行为约束**，不是能力隔离；真正的异构要靠不同工具/权限/模型。agent 也可以按需配 `cwd`（共享沙箱仓库）和 `extraArgs`。
- 假设验证：只有角色标签不够；角色义务 + 私有信息 + 工具/环境反馈才可能产生"提问→补充→指正→结论"。实测见 §11。
- 角色模板库、知识分层、来源和后续计划见 [14 角色模板与开发计划](14-role-templates-and-roadmap.md)。

### 7.3 流式与工具申请

- **流式**：ClaudeAdapter 用 `--include-partial-messages` 取 `text_delta`，Gateway `onEvent` 发 `turn_start / text_delta / tool_use / tool_result / turn_end / skip`；Server 用 SSE `GET /api/events`；UI 在消息末尾显示实时气泡和正在使用的工具，`turn_end` 后移除，等 Matrix 最终消息。
- **工具申请**：系统提示列出当前可用工具；需要不可用工具时 agent 回复 `REQUEST_TOOL: <tool> <原因>`。Gateway 发一条 intent=`tool_request` 的消息（`com.agentim.tool` 带工具名）；UI 显示「批准并继续」；`POST /api/agents/:id/approve-tool` 把该工具加入 `approvedTools`（单工具、持久）、重建 runtime，并以人类身份 @ 该 agent 让它继续。设置页可撤销。
- **硬拒绝**：`toolsMode=off` 用 `--tools "" --permission-mode dontAsk`；只加批准的工具有可用集合。模型在无工具时输出的 DSML/XML tool call 会被 `parseReply` 转成 `tool_request`，不直接发到房间。
- **边界**：审批是 turn 后合作式，不是执行前拦截；批准是单工具、agent 级持久 grant，不改变 toolsMode；流式只流最终文本 delta，不流工具参数/思考。

## 8. 安全边界

- Tuwunel 只绑 `127.0.0.1:8008`；MVP 服务只绑 `127.0.0.1:8790`；不要 bind `0.0.0.0`。
- Matrix token 只在 `app/data/state.json` 和服务端内存；浏览器拿不到。
- `app/data/` 和 `spike/.tmp/` 都 gitignored。不要把 state.json/日志/token 提交。
- 注册 token 只用于初始化；需要时可以关闭 `[global.registration] enable`。
- agent 的 Claude 工具默认可用，系统提示要求"默认只对话，除非明确要求才用工具"；这是提示级约束，不是沙箱。真正隔离留到后面（worktree/容器/审批）。

## 9. 已知限制

- 全局串行队列：不同 thread 不并行。
- turn 中间崩溃会丢该轮回复（入站先标记已消费），不重复。
- 未读只按最近 100 条算；消息更多时可能低估。
- 消息仍是 1.5s 轮询；SSE 只推实时活动，不替代消息落库。
- 房间可以删除（所有成员 leave），但 Matrix 服务器上的历史仍留；设置页能改显示名/模板/工具权限/预算/triage/暂停/系统提示，但不能删除 agent、不能改 runtime、不能移除成员。
- 历史搜索只覆盖每个房间最近 100 条；更早需要分页或索引。
- 流式只流最终文本 delta，不流工具参数/思考；SSE 没有事件回放/断线补发。
- 工具审批是 turn 后合作式：工具先被拒，模型再 `REQUEST_TOOL`；批准是单工具、agent 级持久 grant，不是执行前拦截，也没有按 thread/过期。支持图片/文件，但没有语音/视频、缩略图和断点续传。
- 跨房间 transcript 会持续增长，token 成本更高；隐私靠系统提示约束，不是硬隔离。
- 链上限 10 仍可能产生多轮 agent 消息，成本相应更高；agent 不保证一定互相接话，仍由它们自己判断。
- triage 参数可按 agent 配，但默认值写死在 Gateway；每日 USD 预算按 UTC 日、内存恢复，没有全局总额。
- 工具权限仍是弱隔离；`full` 模式可写，reviewer 的只读靠 prompt，不是强沙箱。
- 单人类；没有邀请第二个人类。
- 没有 E2E 加密（透明房间）。
- agent 的 cwd 默认是各自的空 workspace；实验时可以配共享沙箱，但要让它改真实仓库需要 worktree。

## 10. 下一步

1. 成本控制 v2：triage/预算已完成；待做全局预算、per-thread 预算。
2. 工具审批/沙箱：v1 合作式已完成；待做执行前审批、单工具 grant、worktree/容器沙箱。
3. 房间/agent 管理：暂停已完成；待做删除/改名 agent、移除成员、邀请人类。
4. 真正的第二 runtime（OpenClaw/Codex），验证异构。
5. 数据平台最小版：审计/用量/会话检索；把当前 chat UI 作为入口。
6. 测试：给 `human_all`、链上限、API、store 加自动化；现在 spike 34 个测试。

## 11. 验证记录（2026-11-16）

- spike：`node --test` → **34 tests pass**。
- 真实 Tuwunel + 真实 Claude：
  - 新建 agent `@researcher` → 自动建 DM → 发消息 → Claude 回复。
  - 新建群「讨论组」（claude-dev + researcher）→ 不 @ 发一条 → **两个 agent 都收到并各自回复**。
  - 新建 DM「Claude Dev」→ 不 @ 发消息 → Claude 回复。
  - 侧栏、未读、Agents 页、hash 深链、UI 截图核对。
- 成本：MVP 第一轮验证 4 个 turn，约 **$0.14593**（见 `app/data/audit.jsonl`）。

第二轮（同日下午，根据试用反馈）：

- **跨房间记忆 PASS**：私聊说暗号 → 群里问，它记得但按隐私规则拒绝在群里复述；群里说发布代号 `海豚-7` → 私聊问，直接答出。
- **邀请成员 PASS**：`POST /api/rooms/:id/members` 把 researcher 加进群，成员表更新。
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
