# 15. 术语表

- 目的：统一文档/代码/对话口径；首次出现的术语链接这里。
- 关联：[00 合同](00-requirements-contract.md) · [13 架构](13-mvp-architecture.md) · [19 审视](19-product-and-architecture-review.md)

| 术语 | 定义 |
|---|---|
| Participant | 房间成员的统一实体：human 或 agent；都有地址、显示名、历史 |
| Human / Admin | v0 只有一个人；既是参与者也是治理者（暂停、kill、审批、配置） |
| Agent | 有永久 Matrix 身份、agent home、session、预算和角色的参与者；不是一次工具调用 |
| Agent home | `app/data/agents/<name>/`：workspace、session、knowledge、产物；身份绑这里，不绑进程 |
| Runtime / Adapter | 执行 agent turn 的薄适配器（Claude CLI、script-peer、未来的 Codex/OpenClaw） |
| Gateway | IM 网卡 + floor 调度 + 队列 + 策略 + 审计 + session 映射 + 调用 adapter；不做语义决策 |
| Homeserver | Matrix 服务端（本机 Tuwunel，`127.0.0.1:8008`） |
| Room / DM / Group | Matrix 房间；DM 是 2 人房间，Group 是多人房间；产品 UI 统一为会话 |
| Thread | Matrix thread；v0 消息收发主要在 `main` thread；reply 引用已支持 |
| Floor | 同一 thread 的单写者令牌；同一时刻只有一个 agent 跑 turn；PASS/回复后释放 |
| Turn | 一次唤醒 → runtime 执行（可含多个工具步骤）→ 最多一条最终消息；IM 层 turn |
| Wake / wakePolicy | 哪些消息会唤醒 agent；`human_all` = 人类消息唤醒所有 agent |
| Attention | 当前消息对某 agent 的注意力等级：direct_mention / reply / task_owner / ambient |
| Triage / 分诊 | 跑完整 turn 前的零成本规则判断；ack/冷却/每小时上限会跳过 ambient；不是“剪枝” |
| Intent | 消息意图：chat/proposal/question/answer/decision/task/status/done/blocked/failed/... |
| PASS | agent 判断没有新增价值，不产生 Matrix 消息，直接释放 floor |
| Session / sessionScope | Claude CLI 的持久会话；`agent` = 一个 agent 跨房间共享一份记忆，`room` = 每房间独立 |
| Task / 任务台账 | 持久任务：status/owner/room/dueAt/interval/checkpoints；到期派发一次/按间隔重复 |
| Checkpoint | 任务级检查点；不是 turn 级恢复。重启后只能恢复任务状态，不能恢复进行中的 turn |
| Intake | 人类提出问题 → 需求顾问重述目标/约束 → 推荐 single/pair/squad → 人类确认 |
| Team template | 一次创建一组角色 + 群的模板（software-squad / review-squad / research-squad） |
| Tool mode | `template|full|off`；off 用 `--tools ""` 硬拒绝；批准工具进入 `approvedTools` |
| Kill switch | 硬 kill：停 gateway sync、关闭 runtime；不是杀 app/Tuwunel。软暂停只让下一轮 PASS |
| Audit | `app/data/audit.jsonl`：消息/工具/usage/skip/错误等追加日志；可筛选/导出，暂无回放 |
| SSE | `/api/events` 实时 turn/text_delta/tool/skip 事件；消息落库仍靠 Matrix + 轮询 |
| Benchmark | 固定任务/条件/评分/重复跑；当前 money-rounding，single/pair/squad |

## 避免混用

- “conversation lease” → 本项目用 **floor**。
- “审批” → 区分 **合作式工具申请**（turn 后）与 **执行前 gating/merge 审批**（未做）。
- “任务调度” → 当前只是 **到期派发**，不是 DAG/工作流引擎。
- “暂停” → 区分 per-agent pause、全局软暂停、硬 kill。
