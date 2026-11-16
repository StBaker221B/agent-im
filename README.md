# Agent IM

对等 agent IM：人和 agent 都是房间成员，agent 自己判断是否回复；矩阵传输 + 薄 runtime adapter。

当前是本地 MVP：真实 Matrix（WSL2 + Tuwunel）+ 真实 Claude + 自建网页。

## 快速开始

```bash
# 0. Tuwunel 在 127.0.0.1:8008（见 docs/12）
curl.exe -s http://127.0.0.1:8008/_matrix/client/versions

# 1. 协议测试
cd agent-im/spike && node --test          # 27 tests

# 2. 控制面 + gateway + API
cd agent-im/app && npm start              # http://127.0.0.1:8790

# 3. Web（生产由 app 托管；开发用 Vite）
cd agent-im/web
npm install
npm run build                             # 然后打开 8790
# npm run dev                             # 或 5173，代理 /api
```

打开 `http://127.0.0.1:8790`，用会话列表和 agent 聊天。首次启动会从 `spike/.tmp` 导入原有账号/房间。

**不要同时跑 `spike` 的 `matrix-gateway` 和 `app`**：同一个 agent token 只能一个 sync 客户端。

## 目录

| 路径 | 内容 |
|---|---|
| `spike/` | 协议引擎 + 传输 + Claude adapter + 27 tests（无第三方依赖） |
| `app/` | MVP 控制面 + gateway 宿主 + Web API（无第三方依赖） |
| `web/` | React 19 + Vite 8 产品 UI |
| `docs/` | 正式文档；`docs/records/` 是过程记录 |
| `CLAUDE.md` | 给后续 agent 的工作笔记：布局/命令/不变量/坑 |

## 文档

- [00 需求合同](docs/00-requirements-contract.md)
- [09 Agent 协议](docs/09-agent-protocol.md) — 投递/唤醒/floor/收敛；§14 实现状态
- [13 MVP 架构](docs/13-mvp-architecture.md) — 组件/数据/API/流程/唤醒/限制
- [14 角色模板与开发计划](docs/14-role-templates-and-roadmap.md) — 角色卡、知识分层、来源选项、剩余工作
- [12 Matrix 宿主](docs/12-matrix-host-wsl.md) — WSL2 + Tuwunel
- [10 开发环境](docs/10-dev-setup.md)、[11 组网](docs/11-local-networking.md)
- [NEXT-SESSION](NEXT-SESSION.md) — 下一次从哪继续
- [过程记录](docs/records/README.md)

## 代码检查

`app/` 和 `web/` 用 ESLint + Prettier（不碰 `spike/` 的既有风格）：

```bash
cd agent-im
npm install          # 首次
npm run check        # eslint + prettier --check
npm run format       # 自动格式化
```

提交前跑 `npm run check` 和 `spike/node --test`。

协议行为的改动先写测试；产品 UI 改完跑 `web` 的 `npm run build`。

## 状态与限制

- 已通：真实 Matrix E2E、自建网页、创建 agent/DM/群、邀请成员、删除会话、图片/文件（agent 能读图）、历史搜索、设置页、头像资料、`human_all` 自行判断、链上限、讨论模式、角色模板 + 私有知识、**自主修测试实验（工具 + coder/reviewer 闭环）**。
- 同一个 agent 跨房间共享记忆（一个 Claude session），但私聊内容不主动带到群聊，靠系统提示约束。
- 限制：全局串行、无流式/审批、无删除/暂停 agent、未读按最近 50 条、单人类、无 E2E 加密。
- 成本：`human_all` 下每个 Claude agent 都会跑 turn；实测 4 turn 约 $0.146。下一步先做 triage/冷却/预算。
