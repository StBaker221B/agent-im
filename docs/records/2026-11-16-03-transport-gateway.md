# 2026-11-16-03 Transport + Gateway（Milestone B 代码完成）

- 记录时间：2026-11-16。
- 状态：代码和假总线端到端完成；真实 Matrix 宿主尚未安装（等待重启）。
- 关联：[09 协议](../09-agent-protocol.md) · [10 开发环境](../10-dev-setup.md) · [12 Matrix 宿主](../12-matrix-host-wsl.md)

## 做了什么

### Transport 抽象与实现

- `spike/src/fake-bus.mjs`
  - 进程内假总线：room/members、单调 event log、`since` token、txn id 幂等、长轮询。
  - 用于免费 demo 和 gateway 测试；事件可落 JSONL，重启测试从同一 log 重建。
- `spike/src/matrix-transport.mjs`
  - 每个 Matrix 账号一个 client：`sync` 长轮询、`send`（txn id / `m.mentions` / `m.thread` / `com.agentim.*`）、`getMessages`、`getEvent`、`members`、`join`、`resolveAlias`。
  - 429/5xx/网络错误重试；`kinds` 映射 senderKind。
- `spike/src/gateway.mjs`
  - Engine ↔ transport ↔ runtime 桥；每个 agent 自己的 sync loop；全局串行队列。
  - 投递 vs 唤醒、floor、pass、静默收敛、proposal/tick、turn timeout 中断。
  - 2 人房间自动视为 direct mention（DM 不需要显式 @）。
  - 回复先落 Matrix 拿 event id，再 `agentAct`；txn id 由 `(agent, trigger event)` 决定，重试幂等。
  - 状态持久化：since token、已消费 event id、`lastTs`；重启补课 + 历史水合，旧消息不重跑。
  - JSONL 审计：inbound/outbound、usage、tool_use/tool_result、quiescent、turn_timeout。
- `spike/src/supervisor.mjs`
  - 配置加载、Engine/agent/client/runtime 装配、SIGINT 优雅停止、健康日志。
- `spike/src/script-peer.mjs` / `mock-runtime.mjs`
  - 确定性 participant，用于不花钱的端到端和测试。
- `spike/src/reply.mjs`
  - 共享 `buildAgentPrompt` / `parseReply`；Claude adapter 和 gateway 用同一套 marker。
- `spike/src/claude-adapter.mjs`（增量）
  - session id 持久化到 agent home `sessions/claude.json`；进程重启后 `--resume` 同一 session。
- `spike/scripts/setup-matrix.mjs`
  - 幂等注册/登录用户、建群 + DM、邀请/加入、写 `.tmp/matrix-config.json`。
  - 用 mock homeserver 测过两次运行：用户已存在走登录，房间已存在复用。
- `spike/scripts/say.mjs`
  - 人类身份发消息，自动把 `@localpart` 解析成 `m.mentions`。

### 新命令

```bash
npm run gateway-demo          # 免费：假总线 + mock Claude + script peer
npm run gateway-demo-claude   # 真实 Claude + script peer（约 $0.06）
npm run setup-matrix          # 宿主起来后
npm run matrix-gateway
npm run say -- --text "..."
```

## 实测

- **25 tests pass**（`node --test`）：
  - 13 引擎 + 2 adapter 解析（新增 ASK_HUMAN 阻塞 quiescence、人类回复清审批并唤醒）
  - 4 gateway（群链 + pass + quiescence、DM、volunteer、重启去重）
  - 4 Matrix transport（sync 归一化、send content/txn 幂等、getMessages、members/join/alias/event/whoami/typing）
  - 1 setup-matrix（注册/建群/DM/幂等）
  - 1 gateway×Matrix 集成（mock homeserver）：群链、DM、重启去重走真实 Matrix transport + sync token
- `npm run gateway-demo`：PASS。
  - 群：human @claude-dev → Claude(mock) 回复并 @script-peer → peer 回复 → Claude PASS → quiescent。
  - DM：human 不 @ → peer 回复（2 人房间隐式 direct）。
  - volunteer：ambient 不唤醒；`requestFloor` 后主动发言。
  - 重启：停 gateway 期间发一条 @claude-dev；重启后只处理这一条，旧消息不重跑。
- `npm run gateway-demo-claude`：PASS。
  - transcript：
    - human 问登录方案
    - Claude 给出方案并 @script-peer
    - script peer 回复
    - Claude `DONE:` 收尾
  - in=1381 / out=648 / **$0.059228**；quiescent。
- `setup-matrix` 和 gateway×Matrix 集成只对 mock homeserver 跑过；真实 Tuwunel 待宿主安装后验证。

## 决定

1. **Matrix 宿主：本机 WSL2 + Tuwunel**（用户 2026-11-16 选择）。
   - WSL 两项功能已启用，**重启后生效**；还没有发行版。
   - 用已有的 Ubuntu base rootfs 导入到 `D:\WSL\agentim`。
2. **用 Tuwunel 替代 Conduit**。
   - Conduit 上游基本停更；Tuwunel v2.0.0（2026-11-10）是当前维护版。
   - 单二进制/DEB；默认 RocksDB；`server_name=localhost`、只监听 loopback。
3. **v0 不装 Docker Desktop**。
   - 10 文档昨天写的是 WSL2 + Docker Desktop；本轮确认 Docker Desktop 是 Windows 端的大件，v0 只有一个 homeserver，用 Tuwunel 单二进制更轻。
   - 用户问的“WSL 里放 Docker”如果指 Docker Engine：以后需要 Synapse/Postgres/Element 多服务时，在同一个 WSL 发行版里装 Docker Engine + compose；不是 Docker Desktop。
4. **DM 语义**：2 人房间里的消息自动带 direct mention，agent 不需要被显式 @。
5. **崩溃策略**：入站消息先标记已消费；turn 中间崩溃会丢该轮回复，但不会重复回复/重复扣费。v0 接受。
6. **回复幂等**：Matrix txn id 由 `(agent, trigger event id)` 派生；同一条入站的重试不会产生第二条消息。

## 已知限制

- 全局队列：不同 thread 暂不并行；同一 thread 单写者已保证。
- thread root 只水合一条；长 thread 的细节上下文靠 native session。
- 工具审批、真正的流式输出还没做；`tool_use`/`tool_result` 只进审计。
- Matrix transport 还没连真实 homeserver；真实 E2E、DM、重启补课待验证。
- 没有 per-room policy；同一个 agent 的 wakePolicy/speakMode 是全局配置。
- 审计保留期、预算硬停还没做。

## 下一步

1. 重启 Windows；按 [12](../12-matrix-host-wsl.md) 导入 Ubuntu + 解包/启动 Tuwunel。
2. `npm run setup-matrix -- --registration-token ...`；`npm run matrix-gateway`。
3. 用 `npm run say` 或 Element 验证：群 @、DM、pass、静默收敛、重启去重。
4. 工具审批 / 流式输出；第二个 runtime；数据平台最小版。
