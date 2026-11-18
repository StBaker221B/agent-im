# Team benchmark

这个目录回答一个问题：**多 agent 团队在同等条件下，是否比单 agent 更好？**

一个 benchmark 不是“随便跑一次看看”，而是：

1. **固定任务**：同一份仓库、同一份失败测试、同一份 spec；
2. **固定条件**：同样的模型、工具、时间上限、人类消息数（只发一次任务，不中途提示）；
3. **自动评分**：测试是否通过、测试文件有没有被改、花了多少 turn/USD、有多少 agent 消息/工具调用、耗时；
4. **可重复**：每组用**新建的 agent + 新 session + 独立 workspace**，跑多次看均值和波动；
5. **可对比**：single / pair / squad 在完全相同的任务上跑，结果写 JSON。

## 先决条件

- Tuwunel 在 `127.0.0.1:8008`；
- app 在 `http://127.0.0.1:8790`（`cd app && npm start`）；
- 会真实调用 Claude CLI → **会产生真实成本**。

## 跑

```bash
cd agent-im
node bench/run.mjs --task money-rounding --arms single,pair --runs 2
```

可选：

```bash
# 6 人软件小队（6 个真实 Claude agent/轮，成本最高）
node bench/run.mjs --task money-rounding --arms single,pair,squad --runs 1

# 保留 agent/房间，便于人工检查（默认跑完软删除）
node bench/run.mjs --arms single --runs 1 --keep

# 更长等待/更短宽限
node bench/run.mjs --arms pair --runs 3 --timeout 300 --grace 15
```

结果写到 `app/data/bench/<runId>/results.json`（gitignored），同时打印 summary 表。

## Arms

| arm | 参与者 | 房间 |
|---|---|---|
| `single` | coder | 和人类 DM |
| `pair` | coder + reviewer | 群 |
| `squad` | PM + BA + architect + coder + reviewer + QA | 群 |

每个 agent 都是新建的 Matrix 用户、全新 Claude session，cwd 指向该 arm 的独立 workspace。团队所有成员共享同一个 workspace；single 单独一份，互不污染。

## 任务 fixture

当前任务：`tasks/money-rounding/`

- `src/money.mjs`：`roundCents` 被换成 `Math.round(value*100)/100`，制造半进位 bug；
- `test/money.test.mjs`：契约测试，包含 `average([1.005, 1.005]) === 1.01`；
- `docs/spec.md`：验收说明。

初始 `npm test` 4/5；修复后应 5/5。runner 会对比测试文件 hash，**改测试不算通过**。

新增任务：复制一个 fixture 到 `bench/tasks/<id>/`，给它 `package.json` 的 `npm test`，然后在 `run.mjs` 里补一个 prompt/评分适配（目前测试文件路径固定为 `test/money.test.mjs`，后续会泛化）。

## 指标

- `passed`：最后一次 `npm test` 是否 0；
- `testUnchanged`：测试文件是否没被改；
- `turns` / `costUsd`：该 arm 从开始到结束的 usage 事件；
- `agentMessages` / `toolUses`；
- `seconds`；
- `timedOut`；
- summary：每组通过率、平均 turns/USD/耗时、每次通过的成本。

## 这还不是完美的 benchmark

- 一个任务、一个小 bug；需要更多任务（需求、架构、跨文件、评审、安全）。
- 单次或两次重复，模型随机性会让数字波动；至少 3 次。
- 没有实现“单 Claude + subagent”外部基线；它需要单独的命令/评分适配。
- human intervention 固定为 1 条任务消息；没有模拟人类中途拒绝/补充。
- 评分只看测试；测试通过不等于实现优雅，仍需要人工看 diff。
- 软删除会保留 Matrix 账号，重复跑会积累隐藏账号。

## 下一步

1. 加更多任务和 arm（单 Claude + subagent）。
2. 把测试文件路径/任务 prompt 从 money 专有泛化成任务配置。
3. 加 `diff` 大小、测试覆盖率、reviewer 发现的问题数等质量指标。
4. 用 3 次重复跑出第一张正式的 single/pair/squad 对照表，再决定要不要继续加角色。

## Soak / 长期运行

```bash
node bench/soak.mjs --minutes 5 --interval 1 --kill-every 2
node bench/soak.mjs --minutes 4320 --interval 5 --kill-every 60   # 72h
```

- 创建/复用 `Soak` 群 + script-peer，建一个 interval recurring task；
- 每 10s 检查任务存在、`task_dispatch` audit 次数、agent 消息；
- `--kill-every` 分钟做一次硬 kill/resume；
- 结果写 `app/data/soak/<runId>.json`；
- 只验 gateway/runtime kill，不重启 app 进程；72h 全量还需要外部 supervisor/autostart。
- 短测：2 分钟 + 2 次 kill，dispatches=2、duplicate=0、errors=[]、passed。
