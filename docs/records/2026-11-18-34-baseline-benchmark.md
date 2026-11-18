# 2026-11-18-34 单 Claude + subagent 基线

- 记录时间：2026-11-18。
- 目标：kill criterion 需要“单 Claude + subagent”对照，而不是只有产品内 single/pair/squad。
- 关联：[bench/README](../../bench/README.md) · [19 §8](../19-product-and-architecture-review.md) · [记录 18 可重复 benchmark](2026-11-17-18-repeatable-benchmark.md)

## 实现

- `bench/run.mjs` 新增两个外部 arm：
  - `baseline`：完整 Claude Code（非 `--bare`），允许 Read/Glob/Grep/PowerShell/Edit/Write/Task/Agent；prompt 说“需要时可用 subagent”。
  - `baseline-subagent`：同样工具，但强制至少调用一次 Agent 工具。
- 外部 arm 不走 Matrix、不创建产品 agent/房间；直接 `claude -p` 在独立 workspace 跑，统计 turns/toolUses/subagentCalls/cost/test hash。
- 注意：完整 CLI 会加载用户 plugins/skills，和产品 `--bare` 环境不完全一致；只能当参考基线。

## 结果（money-rounding，N=3）

| arm | 通过 | 测试未改 | 耗时 | turns | subagent 调用 | cost |
|---|---|---|---|---|---|---|
| baseline N=3（可用 subagent） | 3/3 通过 | 是 | 27s 平均 | 17.33 平均 | 0 | $0.3418 平均 |
| baseline（首轮单次） | 5/5 | 是 | 36s | 20 | 0 | $0.3832 |
| baseline-subagent（强制） | 5/5 | 是 | **301s timeout** | 70 | 1 | 未拿到 result（记 0） |
| 产品 single（此前两次） | 5/5 | 是 | 32/39s | 1 | n/a | $0.0915/$0.1393 |
| 产品 pair（此前两次） | 5/5 | 是 | 176/134s | 2 | n/a | $0.9292/$0.6476 |
| 产品 squad（一次） | 5/5 | 是 | 362s timeout | 5 | n/a | $2.547 |

- 普通 baseline 比产品 single 贵约 3–4×，耗时相近；它没觉得需要 subagent。
- 强制 subagent 在小任务上 300s 超时，说明“单 Claude+subagent”不是免费的，且本轮没有可用的成本数。
- baseline 现在同一任务 N=3（3/3 pass，27s，$0.3418，0 subagent）；但仍只有一个任务，不能据此下 kill criterion 结论。

## 边界

- baseline 不是隔离环境：完整 Claude Code 带用户 CLAUDE.md/plugins/skills；产品 agent 是 `--bare`。
- 强制 subagent 超时后没有 `result`，成本为 0 是“未知”不是“免费”；summary 的 timeouts 要一起看。
- N=3 已覆盖 money-rounding；波动仍存在，至少 3–4 个任务才能定质量/成本阈值。
- 没有比较相同任务上的“产品 single”与“外部 baseline”隔离差异。

## 下一步

- 隔离 baseline 配置（临时 CLAUDE_CONFIG_DIR/干净插件）再跑。
- 加多文件需求、评审、重复业务流任务；每个 N≥3。
- 用同一组任务定义 kill criterion 数字。
