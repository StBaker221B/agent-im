# Agent IM 本地协议 spike

纯 Node ESM，无第三方依赖；验证 [09 协议](../docs/09-agent-protocol.md) 的核心规则。当前已接真实 Matrix（WSL2 + Tuwunel），见 [12 宿主](../docs/12-matrix-host-wsl.md)。

```bash
node --test               # 25 个测试
npm run demo              # 人类 + PM/dev/reviewer 的确定性演示
npm run claude-demo       # 真实 Claude Code：首轮 / 连续 / kill+resume
npm run gateway-demo      # 假总线端到端（免费）
npm run gateway-demo-claude
npm run setup-matrix -- --registration-token "<token>"
npm run matrix-gateway
npm run say -- --text "@claude-dev 你好"
npm run ui                # 本地网页控制台 http://127.0.0.1:8787
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

## Transport / gateway

- `src/matrix-transport.mjs`：Matrix client-server API（sync、send、m.mentions、m.thread、txn id）。
- `src/gateway.mjs`：Engine ↔ transport ↔ runtime 桥；每 agent 一个 sync loop；全局串行队列；状态持久化与重启去重。
- `src/supervisor.mjs`：配置装配、健康日志、优雅停止。
- `scripts/setup-matrix.mjs`：幂等注册用户、建群 + DM；`scripts/say.mjs`：人类身份发消息。
- 2026-11-16 真实 Matrix E2E 通过（群 @ 链、DM、不 @ 不唤醒、停机重启去重、quiescent）；见 [记录 04](../docs/records/2026-11-16-04-matrix-e2e.md)。

## 网页控制台

```bash
npm run ui                     # 默认 127.0.0.1:8787，仅 loopback
npm run ui -- --port 8899
```

- 单页 `ui/index.html`；Node 代理持有人类 token，浏览器拿不到 token。
- 群聊 / 私聊切换、参与者、@ 高亮、等待回复提示。
- 需要 Tuwunel 和 `matrix-gateway` 在跑，agent 才会回复。

## Claude adapter

`src/claude-adapter.mjs` 把本机 `claude` CLI 当成 runtime：

- 一个 room/thread 一个长活进程；`--bare --disable-slash-commands --strict-mcp-config --system-prompt-file`。
- 解析 stream-json：session_id、assistant text/tool_use、tool_result、usage/cost。
- `interrupt` = kill；下次 `--resume`；session id 持久化到 agent home，gateway 重启也能续。
- 3 阶段 demo 总成本约 $0.043918；审计写 `spike/.tmp/audit.jsonl`。

## 限制（下一步）

- 全局串行队列；不同 thread 暂不并行。
- turn 中间崩溃会丢该轮回复（入站先标记已消费），不会重复；v0 接受。
- v0 不流式输出；无工具审批。
- 网页控制台是最小演示，不是数据平台；审计/治理视图还没做。
