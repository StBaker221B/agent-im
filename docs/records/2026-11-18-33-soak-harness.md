# 2026-11-18-33 Soak harness

- 记录时间：2026-11-18。
- 目标：B 轨道需要一个可重复的长时间运行/重启检查，而不是只跑一次任务。
- 关联：[17 任务台账](../17-task-ledger.md) · [18 运维](../18-operations.md) · [bench/README](../../bench/README.md)

## 实现

- `bench/soak.mjs`：
  - 复用/创建 `Soak` 群和 script-peer；
  - 创建 recurring task（interval 分钟，owner=script-peer）；
  - 每 10s 检查任务仍在、status、audit `task_dispatch` 次数、房间 agent 消息；
  - `--kill-every N` 分钟执行一次硬 kill/resume；
  - 结果写 `app/data/soak/<runId>.json`；
  - 结束后取消任务；默认删除新建的 Soak 房间（`--keep` 保留）。
- Server 的 dispatch 成功/失败现在写 audit `task_dispatch` / `task_dispatch_error`，soak 用它计派发次数。
- 72h 命令：`node bench/soak.mjs --minutes 4320 --interval 5 --kill-every 60`。app 进程本身的重启不在脚本内，交给 autostart/watchdog 或外部 supervisor。

## 验证

- 2 分钟、interval 1 分钟、kill-every 1 分钟：
  - kills=2，dispatches=2（预期 3，kill 延迟了一次），duplicateOrExtra=0，dispatchErrors=0，agentMessages=2，errors=[]，passed=true。
  - 任务最后 cancelled；Soak 房间已清理。
- 未跑 720h/72h；脚本已可跑，但 app/Tuwunel 进程守护仍依赖外部。

## 边界

- 不是完整的 72h 证明；只有短时验证。
- 只 kill gateway/runtime，不重启 app 进程/Tuwunel；不会验证 OS 级重启。
- 用 script-peer，不验证 Claude 成本/质量。
- `expectedDispatches` 是粗略值；kill/重启会延迟派发，允许多 1 次误差。
- Soak 房间/任务会写进本地数据；任务最后取消，房间默认删。
