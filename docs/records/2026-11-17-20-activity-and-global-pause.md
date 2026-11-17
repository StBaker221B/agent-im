# 2026-11-17-20 活动/审计页 + 全局暂停

- 记录时间：2026-11-17 下午。
- 目标：先补两个不依赖任务台账/鉴权的基本治理功能，验证“独立轨道可以并行推进”。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [14 路线图](../14-role-templates-and-roadmap.md) · [00 合同 §12/§14](../00-requirements-contract.md)

## 活动 / 审计页

- `GET /api/audit?limit=200&kind=&agentId=`：
  - 读 `app/data/audit.jsonl` 最后 5000 行；
  - 过滤 kind/agent，返回最近 250 条；
  - 字段：ts/kind/agentId/roomId/type/name/detail/costUsd/reason。
- UI 侧栏新增「活动」：
  - 3 秒刷新；
  - 类型筛选（消息/工具/成本/triage/budget/paused/error）；
  - agent 筛选；
  - 显示时间、agent、类型、详情、成本。
- 这是 M5“数据平台最小版”的只读第一块，不是完整回放/导出。

## 全局暂停

- `POST /api/admin/pause-all {paused:true|false}`：
  - 遍历所有非 deleted agent，设置 `status` 和 engine `paused`；
  - 当前进行中的 turn 会跑完，下一轮起不再跑；
  - 恢复时把所有非 deleted agent 设为 active（包括之前手动暂停的；这是当前语义）。
- 全局设置页「全局控制」有暂停/恢复按钮；暂停需确认。

## 实测

- `GET /api/audit?limit=5&kind=tool_use` 返回 5 条工具事件，含命令摘要。
- 暂停所有：12 个 agent 全部 paused；恢复：12 个全部 active。
- 无模型调用/成本。
- lint、34 个 spike 测试、web build 通过。

## 边界

- 不是硬 kill switch：没有停 gateway/Tuwunel、没有中断当前 turn、没有撤销 token。
- 活动页只读最近 5000 行/250 条；没有分页、导出、回放。
- 恢复所有会把手动暂停的 agent 也恢复；后续可加“记住之前状态”。
- 删除的 agent 仍会出现在历史事件里（历史审计不改）。

## 下一步

- 任务台账/检查点/恢复（长期驻守核心）。
- 审计导出/回放（依赖任务台账）。
- 通知/告警：预算、失败、审批。
- 自动启动/备份/恢复脚本。
