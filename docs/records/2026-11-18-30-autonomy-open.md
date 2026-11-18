# 2026-11-18-30 自治默认开放 + 可配置收紧

- 记录时间：2026-11-18。
- 触发：用户对 [19 §8](../19-product-and-architecture-review.md#8-已确认的决策2026-11-18) 的回答。
- 关联：[19 审视](../19-product-and-architecture-review.md) · [记录 25 申请房间](2026-11-17-25-agent-room-requests.md) · [记录 29 硬 kill](2026-11-18-29-hard-kill.md)

## 决策落地

- 单人类本机；第二人类后置。
- 自治默认完全开放：
  - agent 可主动建房/联系，**默认无需审批**；
  - 每日预算 0 = 不限；
  - 不强制人工审批。
- 可配置收紧：`state.policy.agentRooms = open | approval`，后续 `agentContact` 同样。
- 隔离口径：指定工作目录内自由操作；目录外受 `toolsMode`/工具权限限制；非编码业务流同理。

## 实现

- `Store.policy` 默认 `{agentRooms:"open", agentContact:"open"}`；bootstrap 带 policy。
- `PATCH /api/settings {policy}` 校验并保存；全局设置「自治」可选 open/approval。
- Gateway `onRoomRequest` 回调：
  - policy=open：服务端直接 `createGroup`（人类 + 发起 agent + 目标），返回 room；Gateway 发“已创建私聊/群”消息；
  - policy=approval 或创建失败：仍走原来的 `room_request` 消息 + UI 批准。
- 所有自动创建的房间仍包含人类，不建人类不可见的 agent-only DM。
- 顺带修复硬 kill 的队列残留：
  - `resetAfterKill()` 清空 floor/queue/pendingApprovals、重置 queue、清 session/cooldown；
  - `runGeneration` 让 stop/start 前旧 sync loop 失效，避免 resume 后双 sync 循环。

## 验证

- bootstrap policy=`{agentRooms:"open",agentContact:"open"}`。
- PM 输出 `REQUEST_ROOM: dm @intake` 后，默认 open 下自动创建了 `私聊-需求顾问` 群（human+PM+intake），无需点批准。
- PATCH policy 到 approval / 回 open 均返回成功。
- 清理测试房间 200；硬 kill→resume 后 killed=false、paused=0、pm idle。
- lint/build 通过；39 tests。

## 边界

- `agentContact` 目前只是持久化字段，未单独强制执行；现有房间内 @/mention 仍开放。
- 自动建房仍包含人类，不是 agent-only 私聊。
- 工作目录隔离仍是弱沙箱；目录外靠 toolsMode/prompt，不是 OS 权限。
- 默认开放意味着 agent 可能主动建房/花钱；预算默认不限，需要时自己收紧。
- kill criterion 仍缺“单 Claude+subagent”基线，数字未定。
