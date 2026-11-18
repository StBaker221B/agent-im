# NEXT SESSION — Agent IM

> 新会话从这里开始。先读 [19 产品与架构审视](docs/19-product-and-architecture-review.md)、[15 术语表](docs/15-glossary.md)、[13 架构](docs/13-mvp-architecture.md)。

## 当前状态（2026-11-18）

- 分支 `agent-im/matrix-e2e`；master 已多次快进推送；最近功能基线见 `git log`。
- 服务：`127.0.0.1:8790`（托管 `web/dist`）；Tuwunel `127.0.0.1:8008`；数据 `app/data/`（gitignored）。
- 测试：`spike` 39 tests；lint/build 通过。
- 产品定义、状态矩阵、剩余 A–F 轨道和 2/6 周计划：见 [19](docs/19-product-and-architecture-review.md)。
- 历史文档 01/03/04/05/06 已标“历史”，不要按它们实现。

## 已完成的主干

- 真实 Matrix + Claude E2E；自由群聊/floor/PASS/收敛；跨房间 session。
- 角色模板 13 + 知识包；团队模板 3；intake 需求顾问。
- 工具权限/triage/用量/每日预算/暂停；token 流；合作式工具申请/单工具 grant。
- 持久任务台账：到期派发、固定间隔重复、checkpoint、agent TASK/DONE/BLOCK/FAIL、重启不重发。
- 活动/审计、全局软暂停、硬 kill、桌面通知、回复引用、成员移除、agent 申请房间。
- 可重复 benchmark：single/pair 各两次、squad 一次；脚本与 fixture 在 `bench/`。
- 运维脚本：`scripts/start-agent-im.ps1`、`backup-data.ps1`、`restore-data.ps1`。
- 自治默认开放（`agentRooms=open`，可配置 approval）；决策见 19 §8。

## 下一批（按 19 §7）

1. **B（W1）**：任务 scheduler v2——cron/工作日、错过补跑一次、retry/backoff、失败/阻塞升级；crash-turn “needs attention”；守护进程；开始 72h soak。
2. **A（W2）**：统一事件 schema + 审批收件箱（工具/房间/merge）+ task/thread 回放 + 预算/失败告警。
3. **E（W3）**：worktree/branch + merge 人类批准 + OS 只读；coding pilot。
4. **C（W4）**：thread 面板、@未读/深链、reaction、搜索分页。
5. **D（W4+）**：API auth/roles/ACL（若决定多用户）、agent card/能力目录、disabled/multi-instance。
6. **F**：onboarding、intake 一键确认、任务详情/停止状态恢复、PWA/mobile/a11y。

## 改前必做

```bash
cd agent-im && npm run check
cd spike && node --test
cd web && npm run build
```

## 不要做

- 不要按 01/03/04/05/06 实现（历史）。
- 不要继续扩角色/团队模板；benchmark 显示 6 人 squad 22× 成本、无质量优势。
- 不要把任务台账做成 DAG/工作流引擎；它是待办 + 派发 + 检查点 + 人升级。
- 不要把合作式工具审批当安全边界；执行前 gating/worktree 另做。
- 不要提交 `app/data/`、`spike/.tmp/`、`web/dist/`。
- 不要同时跑两个 app/gateway 实例（同 token 会重复回复）。
- 不要跳过 00 合同/09 协议/19 审视。
