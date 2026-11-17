# Agent IM 文档索引

## 当前权威（先读）

| 文档 | 内容 |
|---|---|
| [19 产品与架构审视](19-product-and-architecture-review.md) | 2026-11-18 结论、状态矩阵、改进与路线图 |
| [00 需求合同](00-requirements-contract.md) | 目标/角色/协议/生命周期/MoSCoW/验收（正文口径） |
| [13 MVP 架构](13-mvp-architecture.md) | 当前组件、数据、API、流程、限制 |
| [14 角色与路线图](14-role-templates-and-roadmap.md) | 角色模板、团队、成本、benchmark、计划 |
| [15 术语表](15-glossary.md) | 统一术语 |
| [16 长期驻守与 intake](16-long-running-and-intake.md) | 长期运行需求与 intake 设计 |
| [17 任务台账](17-task-ledger.md) | tasks.json、派发、重复、TASK/DONE/BLOCK/FAIL |
| [18 运维](18-operations.md) | 启动/备份/恢复/审计导出 |

## 协议与环境

- [09 Agent 协议](09-agent-protocol.md)：投递/唤醒/floor/收敛/共识/实现状态
- [10 开发环境](10-dev-setup.md)
- [11 本地组网](11-local-networking.md)
- [12 WSL2 + Tuwunel](12-matrix-host-wsl.md)

## 历史/已被取代

以下文档保留决策背景，但**不要按它们实现**：

- [01 需求](01-requirements.md) — 2026-11-15 初稿，已被 00 取代
- [03 架构](03-architecture.md) — 早期方案（per-agent gateway/AppService 等），当前实现见 13
- [04 Agent 集成](04-agent-integration.md) — 早期 adapter 契约，当前见 09/13
- [05 路线图](05-roadmap.md) — 早期 4 周计划，当前见 19
- [06 开放问题](06-open-questions.md) — 大部分已在 00 确认
- [02 prior art](02-prior-art.md) — 调研背景

编号 07/08 未使用，留作未来 ADR/威胁模型；不要复用编号。

## 过程记录

- [records/](records/)：按日期的实现/实验/决策记录；`records/README.md` 是索引。
- 新增记录命名：`YYYY-MM-DD-NN-topic.md`；NN 是当天序号，不再维护全局序号。

## 推荐阅读路径

- 新 agent：19 → 15 → 13 → 14 → 17 → 16 → 18
- 要改协议：00 → 09 → 13 §7 → spike tests
- 要改产品 UI：19 §4/§7 → 13 §1/§5 → web/README
- 要运维：18 → 12 → scripts/
