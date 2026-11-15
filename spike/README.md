# Agent IM 本地协议 spike

纯 Node ESM，无第三方依赖；验证 [09 协议](../docs/09-agent-protocol.md) 的核心规则。

```bash
node --test          # 14 个测试（12 引擎 + 2 adapter 解析）
npm run demo         # 人类 + PM/dev/reviewer 的确定性演示
npm run claude-demo  # 真实 Claude Code：首轮 / 连续 / kill+resume
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

## Claude adapter

`src/claude-adapter.mjs` 把本机 `claude` CLI 当成 runtime：

- 一个 room/thread 一个长活进程；`--bare --disable-slash-commands --strict-mcp-config --system-prompt-file`。
- 解析 stream-json：session_id、assistant text/tool_use、tool_result、usage/cost。
- `interrupt` = kill；下次 `--resume`；2026-11-16 实测 resume 保持同一 session。
- 3 阶段 demo 总成本约 $0.043918；审计写 `spike/.tmp/audit.jsonl`。

## 限制（下一步）

- 内存态，无持久化；重启/恢复用真实 DB 实现。
- v0 不流式输出；无工具审批；没有 Matrix；下一步用 `ImTransport` 适配 Matrix。
- 没有真实计时器；`tick(now)` 由调用方驱动，便于测试。
