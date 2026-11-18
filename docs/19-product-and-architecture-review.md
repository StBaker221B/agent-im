# 19. 产品与架构审视（2026-11-18）

- 状态：审视结论 + 下一阶段计划。
- 依据：00/01/03/04/05/06/09/13/14/16/17/18、NEXT-SESSION、README/CLAUDE、近期 records 29；三份只读审计（产品定义、代码架构、功能/路线图）。
- 关联：[15 术语表](15-glossary.md) · [13 当前架构](13-mvp-architecture.md) · [14 路线图](14-role-templates-and-roadmap.md) · [16 长期驻守](16-long-running-and-intake.md) · [17 任务台账](17-task-ledger.md)

## 0. 结论

- **核心成立**：对等 agent、身份与进程解耦、投递与唤醒分离、透明审计、长期驻守 + 任务台账，这条主线是清楚的。
- **现状**：M3（gateway + Claude + script peer）已完成；M7 大部分完成（去重、预算 skip、硬 kill）；M1/M2/M4/M5 部分；M6（worktree + merge）缺失。
- **产品今天更像“单管理员 coding IM”**；长期驻守只到 v1（状态 + 任务台账），还不够可信。
- **团队价值未证明**：同一小任务 pair 约 6.8× 成本、squad 约 22× 且 362s 超时，质量同为 5/5；在拿到对照数据前，不应继续扩角色/团队模板。
- **最大风险**：范围漂移成通用 IM/工作流引擎；以及服务端/API/UI/状态层缺乏测试。

## 1. 软件定义（建议以此为准）

**一句话**：Agent IM 是一个本地优先、透明可审计的“人 + 常驻 agent 团队”协作环境；agent 是有永久身份、记忆、任务和预算的参与者，不是一次性工具调用。

**是**：

- 平的 peer 图：人和 agent 都是 participant；没有 main 管家。
- 常驻身份 + agent home + 跨房间 session；人对 agent 有治理权。
- 房间对话 + 持久任务台账 + 检查点 + 审计/成本 + 审批/暂停/kill。
- 一人公司 / 稳定业务流的长期运行环境。

**不是**：

- 不是通用 IM/微信/飞书替代品；
- 不是 BPM/工作流引擎（任务台账是“持久待办 + 派发”，不是 DAG 编排）；
- 不是模型网关/推理服务；
- 不是中心化主 agent 调度器；
- v0 不是多租户 SaaS、不做 A2A/federation、不做移动优先。

**核心循环**：

```text
问题 → intake 评估（single/pair/squad） → 人确认
     → 房间讨论 / 任务台账 → agent turn（工具/审批）
     → 审计/成本/检查点 → 完成/阻塞/失败
     → 重启后任务与状态恢复
```

**成功指标（建议）**：

- 72h soak：3 次重启，0 重复回复、0 静默丢任务；
- 目标任务完成率/质量不低于单 Claude+subagent，成本 ≤2×，或人类干预更少；
- 任何停止状态（paused/budget/killed/failed）都有明确恢复动作。

**kill criterion（建议）**：同一组任务（简单修 bug、多文件需求、3 天重复业务流、研究决策）对比单 Claude Code + subagent；若 3/4 任务无质量优势且成本 >2×，或 72h soak 失败，则停止扩团队，转为“单常驻 agent + 治理/可观测层”。

## 2. 需求状态矩阵

| 需求 | 状态 | 缺口 |
|---|---|---|
| M1 身份/生命周期 | 部分 | idle/sleeping/disabled、硬删/恢复、multi-instance；agent home 仍偏薄 |
| M2 DM/群/@/thread/reply/历史 | 大部分 | thread 面板、@未读、reaction、深链、深搜已做；搜索 cursor/索引缺 |
| M3 gateway + Claude + script | 完成 | 需要 conformance/更多回归 |
| M4 自主群聊 | 部分 | decision/proposal/consensus 有引擎/文档，无 UI/持久 artifact |
| M5 数据平台最小版 | 部分 | 活动/用量/导出/暂停/kill、worktree merge 审批有；回放、deploy、告警缺 |
| M6 worktree + merge | **大部分** | worktree/branch + 人工确认 merge；OS 只读/容器缺 |
| M7 重启去重/预算/kill | 大部分 | 硬 kill 有但不持久；预算仍是 PASS skip，不是硬停+通知 |
| S1/S2 第二 runtime | 缺失 | 仅 Claude/script |
| S3 Directory/card | 部分 | card API/Directory/Agents 筛选已做；who_can_help/能力 trust 缺 |
| S4 Cron/触发 | 大部分 | interval/cron/retry；无时区/节假日/多次补跑 |
| S5 审计回放 | 部分 | JSONL 导出/活动视图；无回放/task 范围查询 |
| S6 通知 | 部分 | @ badge/桌面通知/待办页+alert 推送已做；无后台/审批失败预算/飞书 |
| 长期任务台账 | v1.5 | 状态/重复/TASK-DONE-BLOCK-FAIL/retry/needsAttention/autostart/soak harness；无 72h/时区/告警/turn 恢复 |
| 多用户/auth | 缺失 | 单人类、loopback、无 ACL |

## 3. 文档体系：问题与调整

问题：

- 00 声称唯一口径，但 01/03/04/05/06 仍是 2026-11-15 草案，含已废弃的 Docker/Synapse/AppService/per-agent gateway 方案，没有 superseded 标记。
- 06 仍写“待回答”，但 Q1/Q2/Q3/Q10 已在 00 确认；01 §9 重复。
- 状态散落在 00/05/09/13/14/NEXT/README/CLAUDE，互相矛盾（例如 README 仍说不能移除成员；09 §14.3 说无流式/审批；14 用旧 `toolsEnabled`）。
- 编号 07/08/15 空缺；无 `docs/README.md`；records 的全局序号与按日期文件名规则冲突。
- 缺 API reference、运维 runbook（RTO/RPO、恢复演练、升级、token 轮换）、独立 glossary、ADR、threat model、UX spec、runtime conformance suite。

本次调整：

- 新增本文 + [15 术语表](15-glossary.md) + [docs/README.md](README.md) 索引。
- 01/03/04/05/06 加“历史/已废弃，以 00/13/14 为准”标记。
- 13/14/NEXT/README 的重复状态改为“详见本文 §2”，不再各自维护。
- 后续：API reference、ops runbook、ADR（Tuwunel 选择、sessionScope、软删除、loopback 无 auth、任务台账边界）。

## 4. 功能设计：过度与缺口

**过度/冻结**：

- 13 角色 + 13 知识包 + 3 团队模板 + 6 人 squad：benchmark 显示过度；冻结扩角色，保留 4–6 个常用。
- 合作式 post-turn 工具“审批”不是安全边界；不要继续扩 UX，后续要么执行前 gating，要么明确标注“合作式”。
- 任务台账不要长成 DAG/工作流引擎；保持“待办 + 派发 + 检查点 + 人升级”。
- intake 一键建队暂缓到推荐准确率/团队收益有数据；保留人类确认。
- 通用 IM/多用户/飞书/移动/E2E 后置。

**A–F 最小切片**（详见 §7）：

- A 治理：待办收件箱已做；待统一事件、完整 task/thread 回放（任务详情/审计时间线已做）、后台告警推送（桌面 alert 推送/显式拒绝已做）。
- B 长期：cron/补跑、retry/backoff/升级、turn “需关注”、守护进程、72h soak。
- C IM：thread 面板、@未读、深链、深搜已做；待搜索 cursor/索引、thread 分页/未读、decision/proposal UI。
- D 身份：API auth/roles/ACL、第二人类（如果决定）、actor on events。
- E 隔离：worktree/branch + merge 审批已做；待 OS 只读 reviewer、容器、一个非 Claude adapter。
- F UX：空态引导、PWA shell（network-first）、aria-live/减动效、Chromium 实机检查已做；待交互式 onboarding、intake 一键、停止状态恢复、真机/Lighthouse；任务详情已做。

## 5. 代码架构：现状与改进

**热点**：

- `app/server.mjs` 1431 行：单例副作用 + 路由 + 领域操作 + bootstrap + SSE + 审计扫描 + 静态文件，不可注入/测试。
- `spike/src/gateway.mjs` 866 行：sync/ingest/turn/意图映射/task 回调/triage/媒体/持久化混在一起；全局串行队列。
- `web/src/App.jsx` 806 行：路由/全量状态/2.5s bootstrap/1.5s 消息轮询/SSE 合并/所有 mutation。
- `store.mjs` 混合持久化/迁移/spike 导入/prompt/知识 IO；app↔spike 无接口，靠 host switch runtime。

**本次已修（Phase 0）**：

- turn 超时后 `grantNext` 的 grant 没有派发 → 队列会静默卡死；引擎 tick 现在返回 `granted`，gateway 入队 dispatch，并加回归测试。
- 手动 `dispatch` 忽略任务状态 → 现在只允许 pending/blocked，防重复派发。
- 硬 kill 恢复会把手动暂停的 agent 也激活 → 现在 kill 前快照状态，恢复按快照。
- 状态文件非原子写 → store/tasks/gateway 改用 temp+rename 原子写。
- API 无 Origin/Host 防护 → 现在拒绝非 127.0.0.1/localhost/5173 的 Host/Origin（可用 `AGENT_IM_ALLOWED_ORIGINS` 扩展）。
- 任务 BLOCK/FAIL 写回、通知、回复、硬 kill 等文档补齐。

**仍待修**：

- Phase 1（2–3d）：拆 `server.mjs` 为 `createApp(deps)` + `http/` + `services/`；store 拆 persistence/migration/prompt/import；API 测试 harness。
- Phase 2（3–5d）：拆 gateway 为 sync/ingest/turn/outbound/triage/media/state；加 runtime registry；scheduler 先 characterization 再拆。
- Phase 3：App.jsx → hooks + views；ChatView 拆 header/list/composer。
- Phase 4：ImTransport contract、workspace_id、role+scope middleware、audit store rotation/query、env config。
- 不急着动：floor/quiescence/consensus 语义、Matrix wire、角色模板内容、UI 状态库。

## 6. 安全 / 运维 / 测试

- API 目前仍无登录；Origin/Host 只是本机网页防护，不防本机恶意进程。state/backup 含明文 token；audit 含消息/命令；`/api/audit` 可读。多用户前必须做 auth/ACL/token 轮换。
- 工具隔离仍是 prompt/allowlist；worktree/容器/执行前审批未做。
- 测试：38→43 个 spike tests；仍无 app API/store/gateway-host/SSE/UI 测试、无 CI。
- 下一步测试：`createApp` + temp data + MockRuntime；超时→派发、kill/resume 快照、原子写/损坏 JSON、任务状态机；Vitest 覆盖 mergeMessages/路由/审批；一条 env-gated 真实 Tuwunel smoke；后 Playwright happy path。
- 运维：备份非一致性快照；无定时/异地/加密；恢复不跑 smoke；无守护进程；日志无限增长；401 retry 永不放弃。

## 7. 路线图（建议）

**2 周**

- W1（B）：retry/backoff、失败耗尽 needsAttention、autostart/watchdog、5 段 cron、soak harness 已做（2 分钟 + 2 次 kill 通过）；待时区/节假日、多次补跑、告警、真正 72h。
- W2（A + 证明）：待办收件箱已做（请求/任务/预算/系统聚合，可页内批准/重开）；待事件 schema、回放、显式拒绝、告警推送；benchmark 已加 baseline/baseline-subagent，但只有 money-rounding 单次；还需 2 个任务、N≥3、隔离配置，再写决策 memo。
- 里程碑：72h/3 重启/0 重复/0 静默丢任务；kill-criterion 数据存在。

**6 周**

- W3（E）：worktree/branch 创建/移除、cwd 切换、人工确认 merge 已做；待冲突 UI/OS 只读/容器、coding pilot。
- W4（C）：@未读 badge、聊天历史分页已做；thread 面板、消息深链、深搜已做；待 agent reaction、thread 分页/未读、搜索结果分页/索引；D 只做 agent card/disabled；多用户/auth/第二人类后置。
- W5：一个第二 runtime conformance + onboarding/intake 一键（人类确认）+ workspace_id seam。
- W6：7 天 soak、完整 benchmark matrix、go/no-go、打包/文档。
- 顺序：B → A → E → C；D 中 agent card/disabled 穿插；auth/第二人类后置；F 持续穿插。

## 8. 已确认的决策（2026-11-18）

1. **六周租户模型**：单人类本机；**第二人类目前不重要**，D 后置。
2. **人类离线自治**：做成配置项；**默认全部允许、不设每日/任务上限、不需审批、完全放开**，需要时自己收紧。
3. **agent 主动联系**：**默认无需审批**，加配置项；可以收紧为 approval-only。仍保留人类可见（不建人类不可见的 agent-only DM）。
4. **隔离底线**：在 agent 指定工作目录内可自由操作；工作目录外看工具权限模式；非编码业务流同理。当前仍是弱沙箱/worktree 未做。
5. **kill criterion 数字**：初步 baseline 已跑（36s/$0.383；强制 subagent 301s 超时），但只有单任务单次；需更多任务/N≥3/隔离配置后再定阈值。

实现默认值：`dailyBudgetUsd=0`（不限）、自治审批默认开放、agent 可主动建房；配置项可收紧。安全边界仍要标注：这是“默认开放 + 可治理”，不是强隔离。

## 9. 下一步（本次审视后）

1. Phase 0 关键 bug 已修（timeout 派发、manual dispatch、kill snapshot、atomic、Origin）；并补了硬 kill 的 stale floor/queue/generation 清理。
2. 已按决策实现自治默认开放：`agentRooms=open` 自动建房、可配 approval；`dailyBudgetUsd=0`、第二人类后置。
3. 按 W1 做 B 的 scheduler v2（cron/补跑、retry/backoff、失败升级、crash-turn needs attention、守护进程）+ 72h soak；同时补 API 测试 harness。
4. W2 做 A 的审批/告警/回放，并补“单 Claude+subagent”基线；有对照后再定 kill criterion 数字。
5. 再按 E → C → D（D 仅 agent card/disabled；auth/第二人类后置），F 穿插。
