# NEXT SESSION — Agent IM

> 新会话从这里开始。不要重新调研，不要重复安装插件。
> **真实 Matrix E2E 已通过：WSL2 + Tuwunel 2.0.0 + 真实 Claude，群 @ / DM / PASS / 静默收敛 / 停机重启去重全部验证。25 tests。下一步可做工具审批、流式输出、第二个 runtime 或数据平台最小版。不要跳过 00 合同和 09 协议。**

## 当前暂停点（2026-11-16 上午，真实 Matrix E2E 通过）

- 最近功能提交：`0e91c3c`（transport/gateway/Matrix client，分支 `agent-im/matrix-e2e`）；文档在紧随其后的提交里。下个会话先 `git status`，别覆盖。
- 记录：[2026-11-16-04 真实 Matrix E2E](docs/records/2026-11-16-04-matrix-e2e.md)、[03 Transport + Gateway](docs/records/2026-11-16-03-transport-gateway.md)。
- 已完成：
  - `spike/src/fake-bus.mjs`、`matrix-transport.mjs`、`gateway.mjs`、`supervisor.mjs`、`script-peer.mjs`、`mock-runtime.mjs`、`audit.mjs`。
  - `ClaudeAdapter` session 持久化（agent home `sessions/claude.json`）；`scripts/setup-matrix.mjs`、`scripts/say.mjs`。
  - **25 tests pass**（13 引擎 + 2 adapter + 4 gateway + 4 Matrix transport + 1 setup + 1 gateway×Matrix 集成）。
  - **真实 Matrix E2E 通过**：Tuwunel 2.0.0 跑在 WSL2 `agentim`，监听 `127.0.0.1:8008`；`setup-matrix` 一次成功；群 @claude-dev → Claude 回复 @script-peer → peer 回复 → Claude PASS → quiescent；DM 自动 direct；不 @ 不唤醒；停机重启只处理新消息。
  - 真实 Claude 成本：本轮 4 个 turn 约 **$0.029**；更早的 gateway-demo-claude 是 $0.059228。
- Matrix 宿主：**本机 WSL2 + Tuwunel 单二进制**（不是 Docker Desktop）；安装与实测结果见 [12 Matrix 宿主](docs/12-matrix-host-wsl.md)。
- WSL 状态：3.0.5，发行版 `agentim`（Ubuntu 24.04.4，VHDX 在 `D:\WSL\agentim`）；**Tuwunel 用 `nohup` 常驻，没有开机自启**——Windows 重启后需要手动拉起（见下）。

## 开机后先做什么

1. 确认 Tuwunel 在跑：

```bash
curl.exe -s http://127.0.0.1:8008/_matrix/client/versions
```

不通就拉起（WSL 里）：

```bash
wsl -d agentim -u root -- bash -s <<'EOF'
nohup /opt/tuwunel/usr/sbin/tuwunel -c /etc/tuwunel/tuwunel.toml > /var/log/tuwunel.log 2>&1 &
EOF
```

2. 在 Windows：

```bash
cd d:/Git/learn && git status
cd agent-im/spike && node --test
npm run matrix-gateway
# 另开终端：
npm run say -- --text "@claude-dev 你好"
```

3. 想重跑初始化：`npm run setup-matrix -- --registration-token "$(cat .tmp/matrix-registration-token.txt)"`（幂等）。
4. 之后：工具审批/流式输出 → 第二个 runtime（OpenClaw/Codex）→ 数据平台最小版。

## 读什么

按顺序：

1. [00 需求合同](docs/00-requirements-contract.md) — 唯一需求口径
2. [09 Agent 协议](docs/09-agent-protocol.md) — 消息/floor/收敛/共识/adapter；§14 是当前实现状态
3. [12 Matrix 宿主：WSL2 + Tuwunel](docs/12-matrix-host-wsl.md) — 已安装；§12 是本次实测记录和排障
4. [10 开发环境与复现](docs/10-dev-setup.md) — 本机/办公机、spike 命令
5. [11 本地部署与无公网 IP 组网](docs/11-local-networking.md) — EasyTier/Tailscale/VPS；Tuwunel 更新
6. [2026-11-16 真实 Matrix E2E 记录](docs/records/2026-11-16-04-matrix-e2e.md)
7. [2026-11-16 Transport + Gateway 记录](docs/records/2026-11-16-03-transport-gateway.md)
8. [2026-11-16 Milestone A 记录](docs/records/2026-11-16-01-milestone-a.md)
9. [2026-11-15 第三轮答复（过程记录）](docs/records/2026-11-15-04-answers-round3.md)
10. [2026-11-15 第二轮答复（过程记录）](docs/records/2026-11-15-03-answers-round2.md)
11. [2026-11-15 需求澄清（过程记录，含用户批注）](docs/records/2026-11-15-02-clarifications.md)
12. [01 需求](docs/01-requirements.md) · [03 架构](docs/03-architecture.md) · [04 Agent 接入](docs/04-agent-integration.md)
13. [06 待确认问题](docs/06-open-questions.md)

> 文档约定：正式文档 = `docs/0X-*.md`；过程记录 = `docs/records/`（可追加/修改）。

## 当前状态（2026-11-16 真实 Matrix E2E 通过）

- 阶段：**00/09/10/11/12 + 本地 spike + Claude adapter + transport/gateway + 真实 Matrix E2E 完成**；25 tests；真实 Claude 在真实 Tuwunel 上跑通。
- Claude adapter 实测：首轮 / 同进程连续 / kill+`--resume` 都通过；session id 现在持久化到 agent home，gateway 重启也能 resume。
- Gateway 实测：
  - 回复先落 Matrix（fake bus / 真实 homeserver）拿 event id，再 `agentAct`；txn id 由 `(agent, trigger)` 派生，重试不重复。
  - 入站先标记已消费再跑 turn：turn 中间崩溃会丢该轮回复，但不会重复；v0 接受。
  - 2 人房间自动视为 direct mention（DM 不用显式 @）。
  - 全局串行队列；同 thread 单写者已保证，不同 thread 暂不并行。
- 网络：没有公网 IP；本机/办公机都本地。选型见 [11](docs/11-local-networking.md)：EasyTier/Tailscale/ZeroTier 做自己设备互访；Cloudflare Tunnel/VPS 才对外公开。
- WSL 状态：WSL 3.0.5、发行版 `agentim`（Ubuntu 24.04.4）已导入；Tuwunel 2.0.0 常驻监听 `127.0.0.1:8008`；没有 Docker。**重启 Windows 后需要手动拉起 Tuwunel**（没有开机自启）。
- 已确认（A–D/F/E/G）：
  - v0 本地优先、单 Admin、MVP 验证；未来公开/商业只留 6 个扩展缝。
  - 平权 = 身份/消息模型对等 + 治理权限不对称；agent 房间“受治理透明”。
  - agent 生命周期：created → active → idle/sleeping → paused → disabled → deleted；软删保留历史。
  - 先 Claude Code 跑通，再加 Codex/OpenClaw/dsh/Hermes。
  - 数据平台最小版是 Must；Element 只负责聊天。
  - 群聊：lazy consensus + 人类升级。
- 关键设计（00 + 09）：
  - **agent 身份绑 agent home**（config/memory/sessions/workspace），runtime 是可替换 worker；1 个 gateway 进程内多 agent worker。
  - 薄 adapter 契约；ACP 只是 adapter，不是主协议。
  - **投递 vs 唤醒分离**：所有房间成员收到消息；`@` 只是注意力信号；wakePolicy 决定谁跑模型。
  - **自由发言 + 单写者 floor + 静默收敛 + 显式共识/升级**；不是固定轮流。
  - 人类消息是高优先级输入，不是自动打断；内容可反驳，控制命令必须执行。
  - 角色/升级链：task owner → facilitator → agent owner → admin；`can_invite` 由 gateway 强制。
  - 数据平台 v0 用网页；后面可加 Tauri 壳与聊天合成一个产品。
- 已装工具：`spec-driven-development`（addyosmani，codeload 手动装）。
- 仍待定：DM 非 owner human 的规则、审计保留期、`can_invite` 默认值、动态议程角色是否进 v0。
- 环境事实：
  - 本机**没有 Docker Desktop**；WSL2 `agentim` 已可用；C 盘剩 24GB，D 盘 321GB，16GB 内存。
  - 本机只有 Claude Code 2.1.296 + OpenClaw；**Codex/dsh 未安装**；Hermes 未装。
  - 办公机 Win11 Pro 常驻，有 OpenClaw + 飞书 + ACP 的 claude/codex，可作为第二节点。
  - 本机跑 Tuwunel + 一个 gateway + 2–3 个 runtime 实测没问题（约 2–3GB）；不需要 Docker Desktop。
  - 真实 Matrix 已通；下一步是功能纵深（审批/流式/第二 runtime）和产品化，不是基础设施。

## 下一步

1. **已完成**：09 协议、10 开发环境、11 组网调研、12 宿主方案、本地协议 spike、真实 Claude adapter、transport 抽象、gateway、Matrix client、setup 脚本、25 tests、gateway demos。
2. **已完成（2026-11-16）**：真实 Matrix E2E —— WSL2 + Tuwunel、`setup-matrix`、`matrix-gateway`；群 @、DM、pass、静默收敛、重启去重全部验证。
3. **下一步**：工具审批/真正的流式输出；`tool_use` 已经能抓到，approval 还没有。
4. 加第二个 runtime（本机 OpenClaw 或 Codex）验证异构；worktree + 数据平台最小版。
5. 最后做“单 Claude + subagent”对比，作为 kill criterion。
6. 可选的运维项：Tuwunel 开机自启（任务计划程序或 WSL systemd）、Element Desktop 登录实测。

## 不要做什么

- 不要跳过 00 合同 / 09 协议直接写产品代码；Matrix E2E 已完成，下一步是审批/流式/第二 runtime。
- 不要重新做 GitHub 调研（结果在 02 / sources / 11）；Tuwunel 替换 Conduit 的结论在 12。
- 不要重新安装 EGM / interview-me / codegraphcontext / spec-driven-development。
- 不要默认启用 ECC。
- 不要直接暴露家宽做公网服务；先 mesh VPN（EasyTier/Tailscale）或隧道/VPS。**Tuwunel 现在只绑 `127.0.0.1:8008`，不要改成 `0.0.0.0` 或做 portproxy 对外。**
- 不要在没确认的情况下装 **Docker Desktop**；v0 用 Tuwunel 单二进制。以后要 Docker 就在 WSL 里装 Docker Engine（不是 Desktop）。
- 不要把 OpenClaw / Hermes 当 Hub；它们是 participant / adapter。
- 不要引入 main / router 作为系统中心；Hub 是基础设施。
- 不要假设本机有 Docker / Codex / dsh。
- 不要把“平权”理解成权限完全相等；治理权限本来就是不对称的。
- 不要把“自由发言”理解成“并发写同一个 thread”；同一 thread 单写者串行是技术约束。
- 不要提交 `.tmp/matrix-config.json` / `matrix-users.json` / agent sessions（都在 `.tmp`，gitignored）。

## 一句话

> 平的对等 agent IM：人和 agent 都是用户，agent 可以自由讨论/决议/分工，Admin 可见可控，异构 runtime 通过薄 adapter 接入。
