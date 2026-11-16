# Agent IM — agent working notes

对等 agent IM：人和 agent 都是房间成员，agent 自己判断是否回复，异构 runtime 通过薄 adapter 接入。

## 先读

1. `NEXT-SESSION.md` — 当前暂停点、下一步、不要做什么
2. `docs/00-requirements-contract.md` — 唯一需求口径
3. `docs/09-agent-protocol.md` — 投递/唤醒/floor/收敛/共识；§14 是实现状态
4. `docs/13-mvp-architecture.md` — 当前 MVP 的组件、数据、API、流程
5. `docs/12-matrix-host-wsl.md` — WSL2 + Tuwunel 安装与排障

过程记录在 `docs/records/`，可以追加/修改；正式文档在 `docs/0X-*.md`。

## 布局

```
agent-im/
  spike/   # 协议引擎 + 测试 + 旧 CLI demo（无第三方依赖）
  app/     # MVP 控制面 + gateway 宿主 + Web API（无第三方依赖）
  web/     # React + Vite 产品 UI
  docs/    # 正式文档 + records/
```

## 命令

```bash
# 协议测试（改 scheduler/gateway/transport 后必跑）
cd agent-im/spike && node --test          # 27 tests

# MVP 服务（需要 Tuwunel 在 8008）
cd agent-im/app && npm start              # http://127.0.0.1:8790

# Web
cd agent-im/web && npm install
npm run dev                               # 5173，/api 代理到 8790
npm run build                             # dist/，由 app 托管

# 代码检查（app + web；spike 不参与格式化）
cd agent-im && npm install                # 首次
npm run check                             # eslint + prettier --check
npm run format                            # 自动格式化

# Tuwunel（WSL）
wsl -d agentim -u root -- bash -s <<'EOF'
nohup /opt/tuwunel/usr/sbin/tuwunel -c /etc/tuwunel/tuwunel.toml > /var/log/tuwunel.log 2>&1 &
EOF
curl.exe -s http://127.0.0.1:8008/_matrix/client/versions
```

## 不变量

- **一个 agent token 只能有一个 gateway 在 sync**。启动 `app` 前停掉旧 `spike` gateway，否则重复回复。
- **同一 thread 单写者**：floor 串行；PASS 释放；quiescence 30s。
- **唤醒**：Claude agent 默认 `human_all`（人类消息全员判断）；agent 消息只唤醒被 @/回复的；DM 自动 direct。
- **自由讨论默认**：链上限 `maxAgentChain=10`（防死循环，不是轮数限制）；prompt 允许 agent 互相 @ 接话。旧的 `room.mode` 字段保留兼容但不再影响行为，toggle 已移除。
- **dispatch 去重**：`#dispatch` 记录本次已跑的 agent，wake 循环跳过，避免同一条消息里重复 PASS。
- **角色模板**：13 个内置模板（`app/role-templates.mjs`）；`agent.templateId` 决定角色卡，`role` 是宽泛分类。runtime prompt = base + 角色卡 + 角色知识包 + 私有 knowledge。角色是行为约束，不是强权限隔离。
- 改 `templateId` / `toolsMode` / `systemPrompt` 会重建 runtime；改 `knowledge/*.md`、`cwd`、`extraArgs` 后需要重启。
- 工具权限：`toolsMode=template|full|off`。template 按角色推荐；full 放开全部本地工具（含 Edit/Write），用于手动批准；off 关闭。`dontAsk + allowedTools` 是弱隔离，reviewer 的只读靠 prompt。
- 成本护栏：Gateway 规则 triage（直接 @ 必跑；ack/15s 冷却/30 turn/h 跳过 ambient），跳过写 `triage_skip`；`GET /api/usage` 聚合 audit，设置页有用量表。
- 工具白名单：Windows 上 shell 工具名是 `PowerShell`；`dontAsk` 模式下未列入 `--allowedTools` 的工具会被拒。reviewer 的"只读"目前是 prompt 约束，不是强沙箱。
- 沙箱实验：`app/data/experiments/bugfix`；`@fix-coder`/`@fix-reviewer` 的 cwd 指向它（本地 state，不提交）。
- **投递 ≠ 唤醒**：所有成员都收到消息；`@` 只是注意力信号。
- **回复先落 Matrix 再 `agentAct`**；txn id 由 `(agent, trigger)` 派生，重试幂等。
- **同一个 agent = 同一个 session**：`ClaudeAdapter` 默认 `sessionScope: "agent"`，跨房间共享 transcript；隐私靠系统提示，不是硬隔离。要每房间独立就设 `"room"`。
- **媒体下载必须走认证的 v1 端点**：`/_matrix/client/v1/media/download/...` + Bearer；老的 `/_matrix/media/v3/download` 返回 403。浏览器通过 `/api/media` 代理，不直接碰 mxc。
- **token 只在服务端**：浏览器只调 `/api`；`app/data/` 与 `spike/.tmp/` 都 gitignored。
- **只绑 loopback**：Tuwunel 8008、app 8790；不要 0.0.0.0 / portproxy / 公网。
- **不要同时跑两个 app 实例**（同一 8790 会端口冲突；不同端口会双 gateway）。

## 改哪里

| 需求 | 文件 |
|---|---|
| 唤醒/floor/共识 | `spike/src/scheduler.mjs` + `spike/test/scheduler.test.mjs` |
| 消息收发/txn/thread | `spike/src/matrix-transport.mjs` |
| turn 生命周期/审计 | `spike/src/gateway.mjs` |
| Claude 调用/session | `spike/src/claude-adapter.mjs` |
| 控制面 API / 上传 / 媒体代理 | `app/server.mjs` |
| 邀请/删除/建房/leave | `app/matrix-admin.mjs` + `app/server.mjs` |
| 媒体缓存（agent 读图） | `spike/src/gateway.mjs`（`mediaDir` / `#cacheMedia`） |
| 历史搜索 | `app/server.mjs` `/api/search` + `web/src/components/SearchView.jsx` |
| 设置页 | `app/server.mjs` PATCH `/api/agents/:id` + `web/src/components/SettingsView.jsx` |
| 跨房间记忆/session 作用域 | `spike/src/claude-adapter.mjs`（`sessionScope`） |
| 数据/导入/默认提示/拼装 | `app/store.mjs`（`composeSystemPrompt`） |
| 角色模板 + 角色知识包 | `app/role-templates.mjs` + `app/role-knowledge/<id>.md` |
| 私有知识 | `app/data/agents/<name>/knowledge/*.md`（≤12KB） |
| 工具/workspace | state 里 agent 的 `cwd` + `extraArgs`（如 `--permission-mode dontAsk --allowedTools ...`） |
| 注册/建房/邀请 | `app/matrix-admin.mjs` |
| agent/room 动态装配 | `app/gateway-host.mjs` |
| 产品 UI | `web/src/` |
| 设计/数据/API | `docs/13-mvp-architecture.md` |

## 约定

- 新代码用 ESM、`node:` 内建、显式错误信息；`app/` 和 `spike/` 不引第三方依赖。
- 协议行为先写测试（`node --test`），再改引擎。
- API 返回 `{error}`；状态码 400/404/409/502 有意义。
- 提交前：`agent-im` 根目录 `npm run check` + `spike` 的 `node --test`。
- 质量流程：大改前用 `/code-review` 看 diff，功能完成后 `/simplify` 清理；涉及 API/token 用 `/security-review`。不需要再装同类 skill。
- 前端：浏览器不碰 token；消息按 id 去重；发送乐观插入；打开房间标记已读。
- 中文注释/文档可以；标识符和 commit 标题用英文。
- 提交按 `feat(agent-im): ...` / `docs(agent-im): ...`，不要提交 `app/data/`、`spike/.tmp/`。

## 已知坑

- Windows 控制台 `curl` 发中文会按 GBK 丢字节；测试用 Node `fetch` 或浏览器。
- `wsl.exe ... bash -c '...$VAR...'` 从 Git Bash 调时变量可能被外层吃掉；用 stdin：`bash -s <<'EOF'`。
- GitHub 直连被 reset；release 用 `https://gh-proxy.com/<github url>`。
- Claude turn 冷启动 1–2s；`--bare` 仍带工具，默认提示要求"只对话，除非明确要求才用工具"。
- `human_all` 的成本随 agent 数线性增长；看 `app/data/audit.jsonl` 的 usage。
- 未读最多按每房间最近 100 条算；搜索也只覆盖这 100 条。
- 媒体会缓存到 `app/data/media/`；agent 消息里带本地路径，系统提示要求先 Read 再回答。Claude 的 Read 工具必须可用（`--bare` 仍带工具）。
- "正在思考"用 `bootstrap` 的 `room.activity.floor/queued`（Engine 真实状态）；不要再用本地发送计时器，PASS 不会产生消息，会假性滞留。
- `@` 同时解析 localpart 和 displayName；正则用 `\p{L}\p{N}` 才能匹配中文。
- 设置页改系统提示会重建 runtime；下一轮才生效，旧 CLI 会话被关闭。

## 不要做

- 不要重新做 GitHub 调研 / 重装插件 / 装 Docker Desktop。
- 不要跳过 00 合同和 09 协议直接改协议行为。
- 不要把 OpenClaw/Hermes 当 Hub；它们是 participant/adapter。
- 不要把"平权"理解成权限相等；治理权限不对称。
- 不要并发写同一 thread。
