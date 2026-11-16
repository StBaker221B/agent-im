# 2026-11-16-08 讨论模式与 dispatch 去重

- 记录时间：2026-11-16 下午。
- 状态：新增每房间讨论模式；修掉一条消息里 agent 被重复 dispatch 的问题。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [09 协议 §14](../09-agent-protocol.md) · [07 第三轮](2026-11-16-07-mvp-round3.md)

## 用户问题

群聊里每个 agent 好像只发言一次，不能自己维持对话吗？是问题选得不好吗？

## 诊断

不是问题的问题，是当前规则：

- `human_all` 只保证人类消息唤醒每个 agent 一次；
- agent 的消息只唤醒被 @ / 回复的 agent；
- `maxAgentChain=3`；
- 默认系统提示还写着"不要形成互相客套的循环"，抑制了 agent 主动接话。

所以默认是"每人各答一次"，只有 agent 明确 @ 另一个人才会继续。

## 改动

### 1. 每房间 `mode: "brief" | "discussion"`

- `PATCH /api/rooms/:id {mode}`；store 持久化；Engine room.mode 同步。
- 群聊头部新增「讨论模式 / 讨论中」切换按钮（成本提示在 title 里）。
- `discussion` 模式下 agent 链上限从 3 放宽到 6。
- `buildAgentPrompt` 在 discussion 模式追加：如果另一个 agent 的观点有具体疑问/反驳/补充，直接 @ 对方继续；不要重复或客套；没有新增价值就 PASS。
- 默认系统提示把"不要形成互相客套的循环"改成"讨论模式下可以为了推进讨论 @ 对方，但不要客套循环"。

### 2. dispatch 去重

- 问题：一条人类消息 `wake` 了两个 agent，A 先跑并通过 @ 触发了 B 的链路 turn；外层 wake 循环又把 B 跑了一次，产生一个多余 PASS turn（多花钱、多一次假思考）。
- 修复：`#dispatch` 记录本次已 dispatch 的 agent，wake 循环跳过它们。

## 验证

- 讨论组切到 discussion，问"登录用 session 还是 JWT？回应对方，达成结论后停"。
- claude-dev 给出 session 的理由，并主动 `@researcher` 问决定性判据；researcher 接着回应、修正并给出结论。
- 结果：2 条 agent 消息、1 次 agent→agent mention；activity 依次 `claude-dev` → `researcher` → 空。
- 成本：这轮 3 个 turn 约 **$0.286**（其中一个是修复前的多余 PASS；去重后应少一次）。
- 说明：不是强制多轮。模型判断达成结论就停；想更长的辩论，需要在问题里明确要求（例如"至少三轮，每轮回应对方"），或后续加 facilitator/轮次设置。

## 遗留

- 讨论模式最多 6 条 agent 消息/人类消息，成本更高；没有 per-room 预算。
- 没有强制的多轮辩论/主持人角色；仍然靠 agent 自己 @ 和 PASS。
- 讨论模式目前只影响 agent 链上限和 prompt，不改 `human_all` 的初始唤醒。
- 讨论组当前保持 discussion 模式；可在群聊头部切回。
