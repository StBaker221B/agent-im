# Agent IM MVP server

控制面 + gateway 宿主 + Web API。一个进程同时管理人类会话、agent worker 和网页请求。

- 设计说明：[13 MVP 架构](../docs/13-mvp-architecture.md)
- 协议：[09 Agent 协议](../docs/09-agent-protocol.md)
- Matrix 宿主：[12 WSL2 + Tuwunel](../docs/12-matrix-host-wsl.md)

## 运行

前置：

1. Tuwunel 在 `127.0.0.1:8008`（见 docs/12）。
2. `spike/.tmp/matrix-config.json` 存在（`npm run setup-matrix` 生成过）。
3. Node ≥ 22。

```bash
cd agent-im/app
npm start                  # http://127.0.0.1:8790
npm start -- --port 8890   # 端口冲突
```

首次启动会从 `spike/.tmp/` 导入 human/agent/room 到 `app/data/state.json`。
之后以 `app/data/state.json` 为准。

**不要同时跑旧的 `spike` gateway**：同一个 agent token 只能有一个 sync 客户端，否则会重复回复。

## 数据

全部在 `app/data/`，已 gitignored，含敏感信息：

| 文件 | 内容 |
|---|---|
| `state.json` | human/agent 的 token、密码、房间、lastRead；**不要提交** |
| `gateway-state.json` | 每 agent 的 sync since、已消费 event id、lastTs |
| `audit.jsonl` | inbound/outbound/usage/tool 事件，含成本 |
| `agents/<name>/` | Claude session、system prompt、workspace |
| `agents/<name>/knowledge/` | 该 agent 的私有资料；启动时拼进 system prompt |
| `../role-templates.mjs` | 13 个内置角色卡（committed） |
| `../role-knowledge/<id>.md` | 角色知识包，按 templateId 拼进 prompt（committed） |
| `media/` | 房间图片/文件缓存；agent 用消息里的本地路径 Read |

换库/重来：停服务 → 删 `state.json`（和需要时的 `gateway-state.json`）→ 重启会重新导入 spike 设置。Matrix 侧的房间和用户不会自动删除。

### 跨房间记忆

Claude agent 默认 `sessionScope: "agent"`：一个 agent 只有一个 Claude session，所有房间共享同一份 transcript，所以"同一个人"在群聊和私聊里记得同一件事。私聊内容也会进这份 transcript，靠系统提示约束不主动泄露。

要回到每房间独立 session：在 `state.json` 给该 agent 加 `"sessionScope": "room"`，重启服务。切换后新 session 会从头开始。

### Agent workspace / tools（本地实验）

`cwd` 可把 agent 指到共享沙箱/benchmark workspace；默认是自己的 `data/agents/<name>/workspace`。

`toolsMode` 三档：`template`（按角色推荐，默认）、`full`（全部本地工具，含 Edit/Write，手动放开）、`off`（`--tools "" --permission-mode dontAsk` 硬拒绝）。`approvedTools` 是单工具持久授权（设置页可撤销），与 toolsMode 独立。规则 triage 会跳过 ack/冷却/超频的 ambient turn，并写 `triage_skip` 审计；`dailyBudgetUsd`（0=不限）超预算时 turn 前直接 PASS，写 `budget_skip`；用量在 `GET /api/usage`。工具申请走 `REQUEST_TOOL` → `tool_request` 消息 → `approve-tool`；流式活动在 `/api/events`。

`state.json` 的 agent 可选带 `cwd` 和 `extraArgs`，用于把 agent 指到共享沙箱并限制工具：

```jsonc
"cwd": "D:/…/app/data/experiments/bugfix",
"extraArgs": ["--permission-mode", "dontAsk", "--allowedTools", "Read,Glob,Grep,PowerShell,Edit,Write"]
```

- Windows 上 shell 工具名是 `PowerShell`；`dontAsk` 会拒绝未列入白名单的工具。
- reviewer 的"只读"目前靠 prompt，不是强沙箱；PowerShell 仍能写文件。
- 这些字段没有产品 UI，也没有通过 API 暴露。

## API

见 [13 §5](../docs/13-mvp-architecture.md#5-http-api)。摘要：

- `GET /api/bootstrap` — rooms 含 members / lastMessage / unread / `activity`（floor、queued）
- `GET /api/rooms/:id/messages`
- `POST /api/rooms/:id/messages` `{text}`
- `POST /api/rooms/:id/read` `{ts}`
- `POST /api/rooms` `{kind:"dm",agentId}` / `{kind:"group",name,agentIds}`
- `PATCH /api/rooms/:id` `{mode:"brief"|"discussion"}` — 讨论模式
- `DELETE /api/rooms/:id/members/:agentId` — 群聊移除 agent（运行中 409；DM 用删除会话）
- `POST /api/rooms/:id/members` `{agentIds}` — 邀请 agent 进群
- `DELETE /api/rooms/:id` — 所有本地成员 leave，从列表移除
- `POST /api/rooms/:id/upload` `{filename,contentType,data(base64)}` — ≤8MB
- `GET /api/media?uri=mxc://...` — 服务端带 token 下载媒体
- `GET /api/role-templates` — 13 个角色卡
- `GET /api/team-templates` — software-squad / review-squad / research-squad
- `POST /api/team-templates/:id/create` `{prefix,groupName}` — 一次创建一组 agent + 群
- `POST /api/intake` `{problem}` — 确保 `@intake` 顾问、打开 DM、发送评估 prompt（不自动建团队）
- `GET /api/usage` — 按 agent 汇总 audit 的 today/累计 turns + USD
- `GET /api/audit` — 最近约 5000 行 audit 的只读视图（limit/kind/agentId）
- `GET /api/audit/export` — 下载完整 audit.jsonl
- `POST /api/admin/pause-all` — `{paused}` 全局暂停/恢复所有非 deleted agent（当前轮跑完）
- `GET/POST /api/tasks`、`PATCH /api/tasks/:id`、`/checkpoints`、`/dispatch` — 持久任务台账、到期派发、intervalMinutes 重复
- `POST /api/agents` `{username,displayName,runtime,templateId,toolsMode,dailyBudgetUsd,cwd,roles,systemPrompt}`
- `PATCH /api/agents/:id` `{displayName,templateId,toolsMode,dailyBudgetUsd,status,triage,cwd,roles,wakePolicy,systemPrompt}`
- `DELETE /api/agents/:id` — 软删除 agent：离开群、删 DM、隐藏、停 sync；账号/历史保留
- `POST /api/agents/:id/approve-tool` `{tool,roomId}` — 加单工具到 `approvedTools`、重建 runtime、人类消息 @ agent 继续
- `GET /api/events` — SSE：turn/text_delta/tool_use/tool_result/turn_end/skip
- `GET /api/search?q=` — 每个房间最近 100 条
- `GET /api/health`

## 排障

| 现象 | 处理 |
|---|---|
| `no state and no importable spike setup` | 先在 `spike` 跑 `npm run setup-matrix`（docs/12 §8） |
| 创建 agent 报 `M_USER_IN_USE` | 换一个 ID，或删掉 state 里对应 agent 后重试 |
| 说话没人回 | 检查 `/api/health`、`app/data/server.log`；agent 的 `wakePolicy` 是否为 `human_all`；`PING` 一下 Tuwunel |
| 两个 agent 都回 | 这是 `human_all` 的设计：人类消息全员判断。链式互 @ 有 `maxAgentChain=3` 上限 |
| claude 回复很贵 | 群里每个 Claude agent 都会跑一个 turn；看 `audit.jsonl` 的 usage，考虑改 `mention_only` 或加 triage |
| 中文乱码 | 只有 Windows 控制台 curl 会这样；浏览器 fetch 是 UTF-8。测试脚本用 Node fetch |
| token 失效 | 服务启动时会用 `state.json` 里的密码重新登录 human；agent 需重启/重新登录 |

## 不做的事

- 不 bind `0.0.0.0`，不做公网。
- 不把 token 返回给浏览器。
- 不提交 `data/`。
- 不在同一个 agent token 上跑两个 gateway。
