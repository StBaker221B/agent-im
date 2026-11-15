# NEXT SESSION — Agent IM

> 新会话从这里开始。不要重新调研，不要重复安装插件。
> **Milestone A 已完成：真实 Claude adapter + 假总线跑通。下一步是 Matrix transport / 跨机组网 / 工具审批。不要跳过 00 合同和 09 协议。**

## 暂停点（2026-11-16-02，明天继续）

- 最近功能提交：`90722be`；暂停记录：[2026-11-16-02-pause](docs/records/2026-11-16-02-pause.md)。
- 已完成：14 tests、真实 Claude adapter、三阶段 demo（首轮/连续/kill+resume）、总成本 ~$0.043918。
- 明天新会话说：`继续 agent-im。先读 NEXT-SESSION.md 和 docs/records/2026-11-16-02-pause.md。`
- 开机后先跑：`cd d:/Git/learn && git pull && cd agent-im/spike && node --test`。
- WSL 两个功能已启用但**需重启生效**；没有导入 Linux、没有装 Docker；`D:\Install\WSL` 里的 tarball 未使用，可删。

## 读什么

按顺序：

1. [00 需求合同](docs/00-requirements-contract.md) — 唯一需求口径
2. [09 Agent 协议](docs/09-agent-protocol.md) — 消息/floor/收敛/共识/adapter
3. [10 开发环境与复现](docs/10-dev-setup.md) — 本机/办公机
4. [11 本地部署与无公网 IP 组网](docs/11-local-networking.md) — EasyTier/Tailscale/VPS
5. [2026-11-16 Milestone A 记录](docs/records/2026-11-16-01-milestone-a.md)
6. [2026-11-15 第三轮答复（过程记录）](docs/records/2026-11-15-04-answers-round3.md)
7. [2026-11-15 第二轮答复（过程记录）](docs/records/2026-11-15-03-answers-round2.md)
8. [2026-11-15 需求澄清（过程记录，含用户批注）](docs/records/2026-11-15-02-clarifications.md)
9. [01 需求](docs/01-requirements.md)
10. [03 架构](docs/03-architecture.md)
11. [04 Agent 接入](docs/04-agent-integration.md)
12. [2026-11-15 会话笔记（过程记录）](docs/records/2026-11-15-01-session-notes.md)
13. [06 待确认问题](docs/06-open-questions.md)

> 文档约定：正式文档 = `docs/0X-*.md`；过程记录 = `docs/records/`（可追加/修改）。

## 当前状态（2026-11-16 Milestone A 完成）

- 阶段：**00/09/10/11 + 本地 spike + 真实 Claude adapter 完成**；14 个测试通过；3 阶段 demo 跑通；**还没有接 Matrix**。
- Claude adapter 实测：首轮 / 同进程连续 / kill+`--resume` 都通过；总 in=1843 out=319，成本约 **$0.043918**；resume 保持同一 session id。
- 精简参数：`--bare --disable-slash-commands --strict-mcp-config --system-prompt-file`；一句“收到” 942 tokens / $0.0048（完整环境 24,702 / $0.132）。
- 网络：没有公网 IP；本机/办公机都本地。选型见 [11 本地部署与无公网 IP 组网](docs/11-local-networking.md)：EasyTier/Tailscale/ZeroTier 做自己设备互访；Cloudflare Tunnel/VPS 才对外公开。
- WSL 状态：两个 Windows 功能已启用但**需要重启**；没有导入 Linux、没有装 Docker；`D:\Install\WSL` 只有一个未使用的 tarball。
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
  - 本机**没有 Docker Desktop / 可用 WSL 发行版**；C 盘剩 25GB，D 盘 321GB，16GB 内存。
  - 本机只有 Claude Code 2.1.296 + OpenClaw；**Codex/dsh 未安装**；Hermes 未装。
  - 办公机 Win11 Pro 常驻，有 OpenClaw + 飞书 + ACP 的 claude/codex，可作为第二节点。
  - 本机可跑：Conduit + 一个 gateway + 2–3 个 runtime，约 2–3GB；Docker/WSL2 另加 1–2GB。
  - 第一个协议 spike 不需要 Matrix/Docker。

## 下一步

1. **已完成**：09 协议、10 开发环境、11 组网调研、本地协议 spike、真实 Claude adapter（14 tests + 3 阶段 demo）。
2. **Matrix transport**：先决定宿主（本机 WSL2/Ubuntu rootfs、办公机、或 VPS）；没有公网 IP 用 EasyTier/Tailscale 做设备互访，公网访问才用 Cloudflare Tunnel/VPS。
3. 把 spike 的调度器接到 Matrix：1 个 supervisor + 1 个 Claude agent + 1 个脚本 peer；验证 DM、@、主动发言、pass、静默收敛、重启去重。
4. 加工具审批/真正的流式输出；`tool_use` 已经能抓到，approval 还没有。
5. 加第二个 runtime（本机 OpenClaw 或 Codex）验证异构；worktree + 数据平台最小版。
6. 最后做“单 Claude + subagent”对比，作为 kill criterion。

## 不要做什么

- 不要跳过 00 合同 / 09 协议直接写产品代码；先接 Matrix 骨架。
- 不要重新做 GitHub 调研（结果在 02 / sources / 11）。
- 不要重新安装 EGM / interview-me / codegraphcontext / spec-driven-development。
- 不要默认启用 ECC。
- 不要直接暴露家宽做公网服务；先 mesh VPN（EasyTier/Tailscale）或隧道/VPS。
- 不要在没确认的情况下装 Docker Desktop / 导入 Linux；WSL 功能虽已启用但未使用。
- 不要把 OpenClaw / Hermes 当 Hub；它们是 participant / adapter。
- 不要引入 main / router 作为系统中心；Hub 是基础设施。
- 不要假设本机有 Docker / Codex / dsh。
- 不要把“平权”理解成权限完全相等；治理权限本来就是不对称的。
- 不要把“自由发言”理解成“并发写同一个 thread”；同一 thread 单写者串行是技术约束。

## 一句话

> 平的对等 agent IM：人和 agent 都是用户，agent 可以自由讨论/决议/分工，Admin 可见可控，异构 runtime 通过薄 adapter 接入。
