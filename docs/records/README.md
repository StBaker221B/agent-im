# 过程记录（records）

这个目录放**过程文件**，和正式文档分开：

- **过程记录**（本目录）：对话、批注、会议纪要、临时分析、讨论草稿。可以追加、修改、删除；不保证反映当前状态。
- **正式文档**（`docs/0X-*.md`）：反映项目当前状态。随项目推进直接更新/重写；以最新版本为准。

## 命名

`YYYY-MM-DD-NN-slug.md`：

- 日期 + **当天序号**（01、02、…）。序号按创建顺序递增，改写不换号；跨天按日期排序。
- 只有日期不够区分同一天的多条记录，所以必须带序号；需要更细时间可在文件头写 `记录时间：HH:MM`。
- 例：`2026-11-15-01-session-notes.md`、`2026-11-15-02-clarifications.md`。

## 规则

1. 新会话的问答、批注、过程笔记放 `docs/records/YYYY-MM-DD-NN-slug.md`。
2. 结论稳定后，合并进 `docs/00-requirements-contract.md` 或对应正式文档，并在记录里注明“已合并”。
3. 正式文档不要引用过程记录作为唯一依据；过程记录可以引用正式文档。
4. 同一主题可追加，不要为了“整洁”删掉旧记录（除非用户明确要求）。

## 当前记录

| 序号 | 文件 | 内容 |
|---|---|---|
| 01 | [2026-11-15 会话笔记](2026-11-15-01-session-notes.md) | 第一轮调研/设计/工具安装 |
| 02 | [2026-11-15 需求澄清（含用户批注）](2026-11-15-02-clarifications.md) | 私有/商业、平权、agent 用户 vs 实体、群聊规则 |
| 03 | [2026-11-15 第二轮答复](2026-11-15-03-answers-round2.md) | 逐条回答、发言规则重设计、漏洞清单 |
| 04 | [2026-11-15 第三轮答复](2026-11-15-04-answers-round3.md) | runtime 常驻/多 worker、投递 vs 唤醒、角色/升级链、Matrix 备选 |
| 05 | [2026-11-16 Milestone A](2026-11-16-01-milestone-a.md) | 真实 Claude adapter、三阶段 demo、成本、无公网 IP 组网调研 |
| 06 | [2026-11-16 暂停点](2026-11-16-02-pause.md) | 明天继续的入口、环境状态、待拍板、下一步 |
| 07 | [2026-11-16 Transport + Gateway](2026-11-16-03-transport-gateway.md) | transport 抽象、gateway、真实 Claude 端到端、Tuwunel/WSL2 决定 |
| 08 | [2026-11-16 真实 Matrix E2E](2026-11-16-04-matrix-e2e.md) | WSL2 导入、Tuwunel 2.0.0 安装、真实 Matrix 五条验收、成本与遗留 |
| 09 | [2026-11-16 MVP](2026-11-16-05-mvp.md) | 控制面 + React 产品 UI、创建 agent/DM/群、human_all、成本与坑 |
| 10 | [2026-11-16 MVP 第二轮](2026-11-16-06-mvp-round2.md) | 跨房间记忆、邀请成员、新建入口拆分、删除会话、图片/文件 |
| 11 | [2026-11-16 MVP 第三轮](2026-11-16-07-mvp-round3.md) | agent 读图、列表删除、头像资料、历史搜索、设置页、researcher 回复规则 |
| 12 | [2026-11-16 讨论模式](2026-11-16-08-discussion-mode.md) | 每房间 brief/discussion、agent 链上限 6、dispatch 去重 |
| 13 | [2026-11-16 角色模板](2026-11-16-09-role-templates.md) | 角色模板、私有知识、角色 @ 别名、coder×reviewer 实验 |
| 14 | [2026-11-16 自主修测试实验](2026-11-16-10-autonomy-bugfix.md) | 真实失败测试 + 工具 + coder/reviewer，5 turn 自主闭环、成本 |
| 15 | [2026-11-16 角色模板决策](2026-11-16-11-role-template-decisions.md) | 用户批注、13 个角色范围、知识分层、权限观、triage/kill criterion |
| 16 | [2026-11-16 权限/triage/用量](2026-11-16-12-permissions-triage-usage.md) | toolsMode 三档、规则 triage、usage API/UI、成本观察 |
| 17 | [2026-11-16 团队模板](2026-11-16-13-team-templates.md) | software-squad/review-squad、一次创建 N 个 agent + 群 |
| 18 | [2026-11-17 流式与工具审批](2026-11-17-14-streaming-and-tool-approval.md) | text_delta/SSE、REQUEST_TOOL、单工具 grant、off `--tools ""` 硬拒绝 |
| 19 | [2026-11-17 设置/团队/时间](2026-11-17-15-settings-teams-time.md) | 全局/agent 设置拆分、记忆时间戳、团队模板调整、流式保留 |
| 20 | [2026-11-17 团队 pilot](2026-11-17-16-team-pilot.md) | 单 coder vs coder+reviewer：3× 成本/4.7× 时间，质量相同，评审提供独立证据 |
| 21 | [2026-11-17 Agent 软删除](2026-11-17-17-agent-delete.md) | 离开房间、删 DM、隐藏 agent、停 sync；账号保留 |
| 22 | [2026-11-17 可重复 benchmark](2026-11-17-18-repeatable-benchmark.md) | runner + fixture；single/pair 各两次；pair 成本 6.8×、耗时 4.4× |
| 23 | [2026-11-17 长期驻守与 intake](2026-11-17-19-long-running-intake.md) | 需求记录、@intake 顾问、单点 vs 团队建议、重启恢复验证 |
| 24 | [2026-11-17 活动/审计与全局暂停](2026-11-17-20-activity-and-global-pause.md) | 活动页、audit API、pause-all；只读/软暂停边界 |
| 25 | [2026-11-17 持久任务台账](2026-11-17-21-task-ledger.md) | tasks.json、到期派发、checkpoint、任务页、重启不重发 |
| 26 | [2026-11-17 Agent 任务标记](2026-11-17-22-agent-task-markers.md) | `TASK:` 创建、派发消息带 taskId、owner `DONE:` 自动完成 |
| 27 | [2026-11-17 运维脚本与审计导出](2026-11-17-23-ops.md) | start/backup/restore 脚本、audit JSONL 导出 |
| 28 | [2026-11-17 群成员移除](2026-11-17-24-member-removal.md) | DELETE member、群 leave、engine 成员清理、邀请 modal 移除 |
| 29 | [2026-11-17 Agent 申请房间](2026-11-17-25-agent-room-requests.md) | `REQUEST_ROOM`、人类批准、建群/去重、人类可见 |
