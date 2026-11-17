# 2026-11-17-18 可重复团队 benchmark 落地

- 记录时间：2026-11-17 中午。
- 目的：把“团队有没有用”从手工 pilot 升级成固定任务、自动执行、可重复的 benchmark。
- 关联：[bench/README](../../bench/README.md) · [14 路线图](../14-role-templates-and-roadmap.md) · [16 团队 pilot](2026-11-17-16-team-pilot.md)

## benchmark 是什么

一个 benchmark = **固定任务 + 固定条件 + 自动评分 + 重复跑**：

- 同一份仓库、同一份失败测试、同一份 spec；
- 同样的模型、工具、时间上限，人类只发一条任务消息，不中途提示；
- 自动检查测试是否通过、测试文件是否被改、turn/USD/耗时/工具调用；
- 每组新建 agent + 新 Claude session + 独立 workspace；
- 重复多次，看均值和波动，而不是只跑一次“感觉不错”。

## 已落地

- `bench/tasks/money-rounding/`：一个半进位 bug 的 fixture，初始 `npm test` 4/5。
- `bench/run.mjs`：
  - 支持 `single`（coder）、`pair`（coder+reviewer）、`squad`（PM/BA/architect/coder/reviewer/QA）；
  - 每组复制 fixture 到独立 workspace，新建 agent（`cwd` 指向 workspace），发一条任务；
  - 轮询 `npm test` + room activity，等测试通过且房间空闲；
  - 从 audit 统计 turns/USD/tools，对比 test 文件 hash；
  - 结束后删房间、软删 agent（Matrix 账号保留，但 UI 隐藏）。
- app API 增加 `cwd` 创建/更新支持，供 benchmark 使用。
- 用法：`node bench/run.mjs --task money-rounding --arms single,pair --runs 2`。

## 两次独立重复的结果

| 轮次 | 组 | 通过 | 测试未改 | 耗时 | turns | USD | 工具调用 |
|---|---|---|---|---|---|---|---|
| 1 | single | 5/5 | 是 | 32s | 1 | $0.0915 | 8 |
| 1 | pair | 5/5 | 是 | 176s | 2 | $0.9292 | 39 |
| 2 | single | 5/5 | 是 | 39s | 1 | $0.1393 | 10 |
| 2 | pair | 5/5 | 是 | 134s | 2 | $0.6476 | 21 |

- 两次都通过，测试文件都没改，没有 timeout；bench agent/房间都清理为 0。
- pair 的均值约 **$0.788/155s**，single 约 **$0.115/35.5s**：成本约 6.8×，耗时约 4.4×。
- 这个任务上质量相同；pair 多出来的主要是 reviewer 的独立复验（工具调用明显更多）。
- 波动很大（pair 成本 $0.65–$0.93），所以单次结果不能当结论；这就是为什么需要重复跑。

## 边界

- 目前只有一个任务、一个小 bug；没有需求/架构/跨文件/安全任务。
- `squad` arm 已实现但还没跑（6 个真实 Claude agent/轮，成本最高）。
- 没有实现“单 Claude + subagent”外部基线。
- 评分只看测试和测试文件 hash，不看代码质量、diff 大小、reviewer 发现的问题数。
- 软删除保留 Matrix 账号，重复跑会累积隐藏账号。
- 不同 run 的 agent 名字/房间不同，但任务/评分/prompt 固定。

## 下一步

1. 加任务：需求到实现、方案评审、安全审查、跨文件重构。
2. 加外部基线：单 Claude + subagent（同一个 fixture，用单独命令跑）。
3. 至少 3 次重复，报告均值/区间；再决定 6 人 squad 是否值得。
4. 加质量指标：diff 行数、覆盖率、reviewer 发现的问题数、人类干预次数。
