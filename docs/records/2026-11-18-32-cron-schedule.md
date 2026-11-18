# 2026-11-18-32 任务 Cron 调度

- 记录时间：2026-11-18。
- 目标：B 轨道的 cron/工作日场景；固定 interval 之外支持标准 5 段 cron。
- 关联：[17 任务台账](../17-task-ledger.md) · [19 §7](../19-product-and-architecture-review.md)

## 实现

- `TaskStore` 新增 `cron` 字段（5 段：分 时 日 月 周），与 `intervalMinutes` 互斥。
- 支持 `*`、`*/n`、`a-b`、`a-b/n`、逗号列表；周 0/7 都代表周日。
- 本地服务器时区；日/周同时受限时按标准 cron 的 OR 语义。
- 创建 cron 任务时若无 dueAt，自动算下一次；派发后再次计算 next。
- 启动/派发仍只补跑一次：停机跨过多个 cron 点，恢复后按下一次执行，不逐条补。
- UI 新建任务可填 cron；任务卡片显示 `cron <expr>`。
- 非法 cron/永不出现在未来 366 天内的表达式 → 400。

## 验证

- `nextCronAfter("0 9 * * 1-5", 本地 2026-11-18 08:00)` → 当天 09:00。
- 创建 `cron:"0 9 * * 1-5"` 任务，dueAt 自动写入；派发后 dueAt 排到下一次；interval+cron 同时设置被拒绝。
- 新增 cron 单测；spike **42 tests**。
- lint/build 通过。

## 边界

- 没有时区参数（本地）；没有节假日/工作日日历。
- 没有多 missed-run 补跑；只保留下一次。
- 没有秒级/单次 cron；最小粒度分钟。
- 没有“cron 任务的每次 run 历史”；只有 task checkpoints。
- UI 不做 cron 语法预览/下次时间预览。
