# 2026-11-16-12 权限模式、规则 triage、用量视图

- 记录时间：2026-11-16 下午。
- 状态：权限改为“角色定职责 + 手动放开工具”；规则 triage 和用量视图已实现。
- 关联：[14 角色模板与计划](../14-role-templates-and-roadmap.md) · [13 MVP 架构](../13-mvp-architecture.md) · [11 角色模板决策](2026-11-16-11-role-template-decisions.md)

## 用户意见

- 权限不要限制太死；需要时能申请/手动配置。
- reviewer 要写文件也不是不行；权限配置靠 agent 的“人设”，不是靠硬禁止。
- 问 triage 中文叫什么、是不是用逻辑替代 LLM 思考。
- 问 human_all 是什么。
- 问 kill criterion 怎么对比，“优势不是做了才知道吗”。

## 权限模式

- 每个 agent 增加 `toolsMode`：
  - `template`：按角色模板的推荐工具（默认）。
  - `full`：完整本地工具（Read/Glob/Grep/PowerShell/Edit/Write），用于“明确需要时手动放开”。
  - `off`：关闭工具。
- 模板的 `tools` 仍是推荐值；`full` 允许 reviewer/security 写文件，但角色卡/知识包写的是“默认只读；人类明确要求时可以写，并说明改动”。
- 新建 agent / 设置页都有工具权限选择；现有 agent 迁移为 template/off。
- 结论：权限是安全护栏，职责靠角色人设；不是按角色硬禁用。

## 规则 triage

- `Gateway` 在跑完整模型 turn 前做零成本规则判断：
  - 直接 @ / 回复 / task owner：一定跑；
  - 人类消息是纯 ack/emoji（ok/收到/谢谢/👍…）：ambient agent 跳过；
  - 同一 agent 15s 内刚跑过：ambient wake 跳过（防抖/防刷）；
  - 每 agent 每小时最多 30 个 turn：超过后 ambient wake 跳过；
  - 跳过写 audit `triage_skip`（reason: ack/cooldown/hourly_cap）。
- 这是**逻辑初筛**，不是 LLM 判断；不额外花钱。语义复杂的取舍仍交给 agent 自己。
- 实测：群里发“谢谢”，人类消息 +1，两个 agent 都没有跑；audit 里两条 `triage_skip: ack`。

## 每日 USD 预算

- 每个 agent 增加 `dailyBudgetUsd`（0 = 不限，默认 0）。
- Gateway 启动时从 `audit.jsonl` 的 usage 事件恢复“今天已花”；每个 turn 前检查：
  - 已花 >= 预算 → 不调用模型，直接 `agentAct(pass)` 释放 floor，写 `audit.budget_skip`（spent/cap）。
  - 跨 UTC 日会清空当天累计（内存）。
- 设置页每个 agent 有“每日预算 USD（0 = 不限）”输入；用量表可以直接对比今天花费。
- 实测：把 claude-dev 预算设成 $0.01（今天已花 $0.8376），DM 发消息 → 没有 agent 消息，`budget_skip spent=0.8376 cap=0.01`；随后恢复 0。

## 用量视图

- `GET /api/usage` 聚合 `app/data/audit.jsonl` 的 usage 事件，按 agent 汇总今天/累计 turns 和 USD。
- 设置页新增“用量（今天 / 累计）”表，每 5s 刷新。
- 这是观察成本的基础，后续做 USD 预算/冷却配置。

## triage / human_all / kill criterion

- **triage 中文**：分诊 / 初筛 / 分流；“剪枝”更像裁剪分支，不是这里的含义。可以规则，也可以小模型；当前用规则。
- **human_all**：wakePolicy 的一种——人类消息唤醒所有 agent（每个 agent 都跑一个 turn 自己判断）；agent 消息只唤醒被 @/回复的。它是成本高的根源。
- **kill criterion**：先做到可用，再用同一任务对比多 agent IM 与单 Claude + subagent；看质量、token 成本、人类干预。没有明显优势就停止扩张。优势要做了才知道，但可以预先定好指标和止损线，避免事后找理由。

## 遗留

- triage 参数还没有 UI（固定 15s cooldown、30/h、ack skip）。
- 没有 USD 日预算/硬停；用量只是展示。
- 没有“申请权限”的消息流；目前是设置里手动改 toolsMode。
- 规则 triage 不判断语义；复杂任务可能误跳过 ambient agent（直接 @ 可绕过）。
- 工具仍是弱隔离，不是强沙箱。
