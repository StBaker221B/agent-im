# NEXT SESSION — Agent IM

> 新会话从这里开始。不要重新调研，不要重复安装插件。
> **MVP 已通：跨房间记忆、媒体、邀请/删除、搜索、设置拆分、13 角色模板 + 3 团队模板、triage/预算、流式、单工具审批、Agent 软删除、可重复 benchmark；34 tests。下一步是更多团队任务/squad 对照、agent 自主房间、worktree 沙箱、第二 runtime、数据平台。不要跳过 00 合同和 09 协议。**

## 当前暂停点（2026-11-16 下午，MVP 第三轮）

- 最近功能提交：`32e0e4c`（MVP 代码）+ `bbe67a5`（lint/format），分支 `agent-im/matrix-e2e`；文档在紧随其后的提交里。下个会话先 `git status`，别覆盖。
- 记录：[20 活动/审计与全局暂停](docs/records/2026-11-17-20-activity-and-global-pause.md)、[19 长期驻守与 intake](docs/records/2026-11-17-19-long-running-intake.md)、[18 可重复 benchmark](docs/records/2026-11-17-18-repeatable-benchmark.md)、[17 Agent 软删除](docs/records/2026-11-17-17-agent-delete.md)、[16 团队 pilot](docs/records/2026-11-17-16-team-pilot.md)。
- 已完成：
  - `spike/`：协议引擎 + 34 tests；`human_all`、`maxAgentChain=10`（防死循环）、动态 room/agent；`sessionScope="agent"`；媒体缓存（`mediaDir` / `#cacheMedia`）。
  - `app/`：创建/邀请/删除/上传/媒体代理/搜索/PATCH agent。
  - `web/`：单列会话、@（中文显示名）、独立新建会话/agent、邀请、删除（头部+列表右键/⋯）、图片/文件、头像资料、历史搜索、全局设置 + agent 独立设置页、深链。
  - **图片理解 PASS**：上传 `VISION-OK 42`，agent 读到本地缓存并描述出来。
  - **researcher 回复 PASS**：`@研究员` 正确解析；直接提问必回（不再 PASS 回避）。
  - 搜索 `海豚`、PATCH 设置、列表删除均已验证。
  - 思考指示改为 Engine `room.activity`（floor/queue），PASS 后自动消失；侧栏 `⋯` 预留列不再挡字。
  - **自由讨论**：链上限 10（防死循环），prompt 允许 agent 互相 @ 接话；旧讨论模式 toggle 已移除；`#dispatch` 去重避免重复 PASS。
  - **角色模板库（13 个）**：generic + 软件（architect/coder/reviewer/qa/ops/security）+ 产品（facilitator/PM/BA/researcher/writer）+ 经营（operations）；每张卡有职责/边界/决策权/思维/沟通/交接/成功标准；`app/role-knowledge/*.md` 角色知识包；runtime prompt = base + 角色卡 + 知识包 + 私有 knowledge；新建/agent 设置页可选模板、预览、工具开关。
  - **团队模板（3 个）**：software-squad（PM/BA/architect/coder/reviewer/qa）、review-squad（architect/reviewer/security）、research-squad（researcher/tech-writer）；一次注册 N 个 agent + 建群；Agents 页「创建小队」。
  - **团队 pilot**：同一小 bug，单 coder 1 turn/$0.2237/~16s；coder+reviewer 2 turns/$0.6690/~75s；都 5/5。团队成本约 3×、耗时约 4.7×，这个任务上没有质量优势；6 人小队未做完整对照。
  - **可重复 benchmark**：`bench/run.mjs` + `bench/tasks/money-rounding`；fresh agent/session/workspace、自动评分/清理。两次：single 32/39s、$0.0915/$0.1393；pair 176/134s、$0.9292/$0.6476；squad 一次 362s 超时/5 turns/$2.547；都 5/5、测试未改；单 Claude+subagent 基线未跑。
  - **长期驻守/intake v0**：`@intake` 需求顾问 + `POST /api/intake` + Agents 页「评估需求」；输出重述/推荐/成本/风险/最小验证/`RECOMMEND`，不自动建团队；重启后 agent/DM/消息保留、不重复回复。任务台账/调度/检查点/未完成 turn 恢复未做。
  - **活动/审计 + 全局暂停**：`GET /api/audit` + 侧栏「活动」（最近 250 条、3s 刷新、按 agent/类型筛选）；设置页暂停/恢复所有 agent（软暂停，当前轮跑完）。仍无导出/回放/硬 kill。
  - **设置拆分**：全局设置只放系统/用量；每个 agent 在 Agents 页「设置」有独立页（模板/工具/预算/triage/暂停/提示/已批准工具）；页面底部可软删除 agent（离开群/删 DM/隐藏，账号保留）。
  - **时间戳记忆**：每轮 prompt 带 Current time，recent messages 和新消息带本地时间；旧 transcript 无时间戳时要求 agent 说不确定；实测 pm 答对日期时间。
  - 角色别名 @reviewer/@coder 在唯一时解析；arch-coder×arch-reviewer 实测形成"提案→质疑→修正→确认"闭环。
  - **自主工具循环**：沙箱 failing tests + fix-coder/fix-reviewer 的 cwd/工具白名单；1 条人类消息、5 个 agent turn、0 次干预，reviewer 发现测试没覆盖的 `-$5` 解析不对称并推动 coder 再修，5/5 通过，约 $2.16。
  - **成本护栏**：规则 triage（直接 @ 必跑；ack/冷却/每小时上限跳过 ambient，参数可在 agent 设置页调）+ `triage_skip` 审计；`GET /api/usage` + 设置页用量；`toolsMode=template|full|off`；每 agent `dailyBudgetUsd`（超预算 PASS + `budget_skip`）；`status=paused`（`paused_skip`）。
  - **流式 + 工具审批**：`--include-partial-messages` → `text_delta` → SSE `/api/events` → UI 实时气泡；系统提示列可用工具，需要时 `REQUEST_TOOL: <tool> <原因>`（或 DSML 兜底）→ intent=`tool_request` → UI 批准 → `approve-tool` 加单工具 + 人类 @ 它继续。`toolsMode=off` 用 `--tools "" --permission-mode dontAsk` 硬拒绝；`approvedTools` 可在 agent 设置页撤销。
  - 成本：第三轮 2 个 turn 约 **$0.041**；整个 MVP 累计 21 turn 约 **$0.577**。
- 运行：app `127.0.0.1:8790`（托管 `web/dist`）；数据 `app/data/`（gitignored）；Tuwunel `127.0.0.1:8008`。
- 文档：[13 MVP 架构](docs/13-mvp-architecture.md)、[14 角色模板与开发计划](docs/14-role-templates-and-roadmap.md)、[agent-im/CLAUDE.md](CLAUDE.md)、`app/README.md`、`web/README.md`。
- Matrix 宿主：WSL2 + Tuwunel 单二进制；**Tuwunel 用 `nohup` 常驻，没有开机自启**。

## 开机后先做什么

1. 确认 Tuwunel 在跑：

```bash
curl.exe -s http://127.0.0.1:8008/_matrix/client/versions
```

不通就拉起（WSL 里）：

```bash
wsl -d agentim -u root -- bash -s <<'EOF'
nohup /opt/tuwunel/usr/sbin/tuwunel -c /etc/tuwunel/tuwunel.toml > /var/log/tuwunel.log 2>&1 &
EOF
```

2. 启动 MVP（**不要**同时跑 `spike` 的 matrix-gateway）：

```bash
cd d:/Git/learn && git status
cd agent-im/spike && node --test          # 34 tests
cd d:/Git/learn/agent-im/app && npm start # http://127.0.0.1:8790
# 另开终端：可重复团队 benchmark（需 app 在跑，真实成本）
cd d:/Git/learn/agent-im && node bench/run.mjs --task money-rounding --arms single,pair --runs 2
```

3. 改了前端：`cd d:/Git/learn/agent-im/web && npm run build`（dev 用 `npm run dev`，5173 代理 `/api`）。
4. 想重跑 spike 初始化：`npm run setup-matrix -- --registration-token "$(cat .tmp/matrix-registration-token.txt)"`（幂等）。
5. 之后：成本控制（triage/冷却/预算）→ 流式/审批 → 删除/暂停/邀请人类 → 第二 runtime → 数据平台。

## 读什么

按顺序：

1. [00 需求合同](docs/00-requirements-contract.md) — 唯一需求口径
2. [09 Agent 协议](docs/09-agent-protocol.md) — 消息/floor/收敛/共识/adapter；§14 是当前实现状态
3. [13 MVP 架构](docs/13-mvp-architecture.md) — 组件、数据、API、流程、唤醒、限制
4. [14 角色模板与开发计划](docs/14-role-templates-and-roadmap.md) — 角色卡、知识分层、来源选项、剩余工作
6. [CLAUDE.md](CLAUDE.md) — 给后续 agent 的工作笔记（布局/命令/不变量/坑）
7. [12 Matrix 宿主：WSL2 + Tuwunel](docs/12-matrix-host-wsl.md) — 已安装；§12 是实测记录和排障
8. [10 开发环境与复现](docs/10-dev-setup.md) — 本机/办公机、spike/MVP 命令
9. [11 本地部署与无公网 IP 组网](docs/11-local-networking.md) — EasyTier/Tailscale/VPS；Tuwunel 更新
10. [2026-11-16 MVP 记录](docs/records/2026-11-16-05-mvp.md)
11. [2026-11-16 真实 Matrix E2E 记录](docs/records/2026-11-16-04-matrix-e2e.md)
12. [2026-11-16 Transport + Gateway 记录](docs/records/2026-11-16-03-transport-gateway.md)
13. [2026-11-16 Milestone A 记录](docs/records/2026-11-16-01-milestone-a.md)
14. [2026-11-15 第三轮答复（过程记录）](docs/records/2026-11-15-04-answers-round3.md)
15. [2026-11-15 第二轮答复（过程记录）](docs/records/2026-11-15-03-answers-round2.md)
16. [2026-11-15 需求澄清（过程记录，含用户批注）](docs/records/2026-11-15-02-clarifications.md)
17. [01 需求](docs/01-requirements.md) · [03 架构](docs/03-architecture.md) · [04 Agent 接入](docs/04-agent-integration.md)
18. [06 待确认问题](docs/06-open-questions.md)

> 文档约定：正式文档 = `docs/0X-*.md`；过程记录 = `docs/records/`（可追加/修改）。

## 当前状态（2026-11-16 MVP 第三轮）

- 阶段：**00/09/10/11/12/13 + spike 协议 + 真实 Matrix + MVP（app/web）第二轮完成**；34 tests；真实 Claude 在真实 Tuwunel 上跑通；网页可直接聊天。
- MVP 行为：
  - 单列会话（DM/群混排）+ 聊天窗；`+` 只新建私聊/群聊；Agents 页独立「新建 agent」；未读；深链。
  - 群聊可邀请 agent；会话可删除（头部/列表右键/⋯）；支持图片/文件（≤8MB）；agent 能读图。
  - 群聊默认自由讨论：agent 可以互相 @ 继续，链上限 10 只是防死循环。
  - 13 个角色模板 + 角色知识包 + 每个 agent 的私有 `knowledge/*.md`；agent 设置页/新建 agent 可选模板、预览、工具权限三档；Agents 页可创建小队（3 个团队模板）。
  - 规则 triage + 用量视图；不额外调用模型。
  - agent 可按需配 `cwd` + `extraArgs`（工具白名单）；目前是本地 state，没有产品 UI，也不是强沙箱。
  - 头像可看资料；侧栏搜索框回车搜历史；agent 设置页可改显示名/模板/工具/预算/triage/暂停/提示。
  - 创建 agent = 注册 Matrix 用户 + 写 state + 动态 attach 到 gateway；创建后自动开 DM。
  - `human_all`：人类消息所有 Claude agent 都会判断；agent 消息只唤醒被 @/回复的；`maxAgentChain=10`（防死循环）；直接提问/私聊必须回应。
  - **同一个 agent 一个 session（`sessionScope="agent"`）**：群聊和私聊共享记忆；私聊隐私靠系统提示。
  - `@` 支持 localpart 和中文 displayName（`@研究员`）。
  - 数据在 `app/data/state.json`（token/密码/房间/已读），首次从 `spike/.tmp` 导入。
- MVP 实测：
  - 第一轮：新建 researcher → DM 回复；群「讨论组」不 @ → claude-dev + researcher 都回复；4 turn 约 $0.146。
  - 第二轮：群里说 `海豚-7` → 私聊答出；私聊暗号在群里记得但拒绝复述；邀请 researcher、SVG 图片、删除测试群均通过；4 turn 约 $0.112。
- Claude adapter 实测：首轮 / 同进程连续 / kill+`--resume` 都通过；session id 现在持久化到 agent home，gateway 重启也能 resume。
- Gateway 实测：
  - 回复先落 Matrix（fake bus / 真实 homeserver）拿 event id，再 `agentAct`；txn id 由 `(agent, trigger)` 派生，重试不重复。
  - 入站先标记已消费再跑 turn：turn 中间崩溃会丢该轮回复，但不会重复；v0 接受。
  - 2 人房间自动视为 direct mention（DM 不用显式 @）。
  - 全局串行队列；同 thread 单写者已保证，不同 thread 暂不并行。
- 网络：没有公网 IP；本机/办公机都本地。选型见 [11](docs/11-local-networking.md)：EasyTier/Tailscale/ZeroTier 做自己设备互访；Cloudflare Tunnel/VPS 才对外公开。
- WSL 状态：WSL 3.0.5、发行版 `agentim`（Ubuntu 24.04.4）已导入；Tuwunel 2.0.0 常驻监听 `127.0.0.1:8008`；没有 Docker。**重启 Windows 后需要手动拉起 Tuwunel**（没有开机自启）。
- 已确认（A–D/F/E/G）：
  - v0 本地优先、单 Admin、MVP 验证；未来公开/商业只留 6 个扩展缝。
  - 平权 = 身份/消息模型对等 + 治理权限不对称；agent 房间“受治理透明”。
  - agent 生命周期：created → active → idle/sleeping → paused → disabled → deleted；软删保留历史。
  - 先 Claude Code 跑通，再加 Codex/OpenClaw/dsh/Hermes。
  - 数据平台最小版是 Must；Element 只负责聊天。
  - 群聊：lazy consensus + 人类升级。
- 关键设计（00 + 09）：
  - **agent 身份绑 agent home**（config/memory/sessions/workspace），runtime 是可替换 worker；1 个 gateway 进程内多 agent worker。
  - 薄 adapter 契约；ACP 只是 adapter，不是主协议。
  - **投递 vs 唤醒分离**：所有房间成员收到消息；`@` 只是注意力信号；wakePolicy 决定谁跑模型。
  - **同一个 agent 跨房间一份记忆**：`sessionScope="agent"`；但私聊内容不主动带到群聊，靠系统提示约束。
  - **自由发言 + 单写者 floor + 静默收敛 + 显式共识/升级**；不是固定轮流。
  - 人类消息是高优先级输入，不是自动打断；内容可反驳，控制命令必须执行。
  - 角色/升级链：task owner → facilitator → agent owner → admin；`can_invite` 由 gateway 强制。
  - 数据平台 v0 用网页；后面可加 Tauri 壳与聊天合成一个产品。
- 已装工具：`spec-driven-development`（addyosmani，codeload 手动装）。
- 仍待定：DM 非 owner human 的规则、审计保留期、`can_invite` 默认值、动态议程角色是否进 v0。
- 环境事实：
  - 本机**没有 Docker Desktop**；WSL2 `agentim` 已可用；C 盘剩 24GB，D 盘 321GB，16GB 内存。
  - 本机只有 Claude Code 2.1.296 + OpenClaw；**Codex/dsh 未安装**；Hermes 未装。
  - 办公机 Win11 Pro 常驻，有 OpenClaw + 飞书 + ACP 的 claude/codex，可作为第二节点。
  - 本机跑 Tuwunel + 一个 gateway + 2–3 个 runtime 实测没问题（约 2–3GB）；不需要 Docker Desktop。
  - 真实 Matrix 已通；下一步是功能纵深（审批/流式/第二 runtime）和产品化，不是基础设施。

## 下一步

1. **已完成**：09 协议、10 开发环境、11 组网调研、12 宿主方案、本地协议 spike、真实 Claude adapter、transport/gateway、真实 Matrix E2E、**MVP（app + web）三轮**、**13 个角色模板 + 知识包 + 创建/设置 UI**；34 tests。
2. **成本控制 v2 已做**（规则 triage/用量/每日预算/参数 UI）；待做全局预算、per-thread 预算。`human_all` 下每条人类消息仍可能触发 N 个 Claude turn。
3. **流式 + 工具审批 v1 已做**（单工具 grant、DSML 兜底、off 硬拒绝）；待做执行前工具审批、按 thread/过期授权、worktree/容器沙箱、SSE 断线补发。
4. 房间/agent 管理：软删除/改显示名已完成；待做硬删除/undelete、移除成员、邀请第二个人类、批量操作（会话删除、邀请 agent、改模板/工具/预算、暂停/启用已完成）。
5. 历史搜索：现在每房间最近 100 条子串匹配；做分页/索引（Matrix `/search` 或本地索引）。
6. 跨房间记忆的隐私硬化：现在是系统提示级；可做 memory 摘要 + 每房间 session，或给 agent 受控 memory 文件。
7. **角色真正的异构 + 工具沙箱**：现在 cwd/工具白名单只写在本地 state，reviewer 的只读靠 prompt；要给 coder worktree、reviewer 只读权限、researcher 资料/搜索，并做真正的沙箱/审批。
8. 加第二个 runtime（本机 OpenClaw 或 Codex）验证异构。
9. 数据平台最小版：审计/用量/会话检索；把当前 chat UI 作为入口。
10. 最后做“单 Claude + subagent”对比，作为 kill criterion；benchmark runner 已有，需要补外部基线 arm。
11. 团队 benchmark v1 已完成（money-rounding、single/pair 各两次）；待更多任务、squad、外部基线、质量指标。
12. 可选运维：Tuwunel 开机自启（任务计划程序或 WSL systemd）、Element 登录实测。
13. 长期驻守/intake：需求在 `docs/16-long-running-and-intake.md`；v0 有 `@intake` 和重启状态恢复；下一步任务台账/调度/检查点/未完成 turn 恢复，以及按 `RECOMMEND` 一键创建 single/pair/squad。

## 不要做什么

- 不要跳过 00 合同 / 09 协议直接写产品代码；MVP 骨架已完成，下一步是成本控制/审批/流式/管理面。
- **不要同时跑 `spike` 的 `matrix-gateway` 和 `app`**：同一个 agent token 只能有一个 sync 客户端，否则重复回复。
- 不要重新做会话列表/新建会话/agent 创建——`web/` 和 `app/` 已经有了；在它上面迭代。
- 不要提交 `app/data/state.json`、`gateway-state.json`、`audit.jsonl`、`agents/`（含 token/密码）。
- 不要重新做 GitHub 调研（结果在 02 / sources / 11）；Tuwunel 替换 Conduit 的结论在 12。
- 不要重新安装 EGM / interview-me / codegraphcontext / spec-driven-development。
- 不要默认启用 ECC。
- 不要直接暴露家宽做公网服务；先 mesh VPN（EasyTier/Tailscale）或隧道/VPS。**Tuwunel 现在只绑 `127.0.0.1:8008`，不要改成 `0.0.0.0` 或做 portproxy 对外。**
- 不要在没确认的情况下装 **Docker Desktop**；v0 用 Tuwunel 单二进制。以后要 Docker 就在 WSL 里装 Docker Engine（不是 Desktop）。
- 不要把 OpenClaw / Hermes 当 Hub；它们是 participant / adapter。
- 不要引入 main / router 作为系统中心；Hub 是基础设施。
- 不要假设本机有 Docker / Codex / dsh。
- 不要把“平权”理解成权限完全相等；治理权限本来就是不对称的。
- 不要把“自由发言”理解成“并发写同一个 thread”；同一 thread 单写者串行是技术约束。
- 不要提交 `.tmp/matrix-config.json` / `matrix-users.json` / agent sessions（都在 `.tmp`，gitignored）。

## 一句话

> 平的对等 agent IM：人和 agent 都是用户，agent 可以自由讨论/决议/分工，Admin 可见可控，异构 runtime 通过薄 adapter 接入。
