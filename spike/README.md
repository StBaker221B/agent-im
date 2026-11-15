# Agent IM 本地协议 spike

纯 Node ESM，无第三方依赖；验证 [09 协议](../docs/09-agent-protocol.md) 的核心规则。

```bash
node --test      # 12 个测试
npm run demo     # 人类 + PM/dev/reviewer 的确定性演示
```

## 覆盖

- 投递到所有房间成员；mention 只是注意力信号。
- 唤醒策略（all / mention_or_reply / mention_only / digest）。
- mention 优先级；volunteer；pass 释放 floor。
- 同一 thread 单写者；不同 thread 可并行（引擎层未强制 session 并发，留给 adapter）。
- 静默收敛（无 thinking/working/waiting/error、无未完成 task/question/approval、无 open proposal、quiet window）。
- lazy consensus + objection 升级；升级链 task owner → facilitator → agent owner → admin。
- 幂等（入站 event id / 出站 txn id）。
- `canInvite` 权限。
- interrupt 抢占 floor；turn timeout。
- `whoCanHelp` 按 roles/domains。

## 限制（下一步）

- 内存态，无持久化；重启/恢复用真实 DB 实现。
- 脚本 agent，不是真实 Claude runtime；下一步接 Agent SDK / CLI。
- 没有 Matrix；下一步用 `ImTransport` 适配 Matrix。
- 没有真实计时器；`tick(now)` 由调用方驱动，便于测试。
