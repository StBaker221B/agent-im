# NEXT SESSION — Agent IM

> 新会话从这里开始。不要重新调研，不要重复安装插件。
> **在 00 合同的 E/G/H 确认前，不要写产品代码；协议 spike 可以先做。**

## 读什么

按顺序：

1. [00 需求合同（草案）](docs/00-requirements-contract.md) — 唯一需求口径
2. [2026-11-15 第二轮答复（过程记录）](docs/records/2026-11-15-answers-round2.md) — 逐条回答与设计
3. [2026-11-15 需求澄清（过程记录，含用户批注）](docs/records/2026-11-15-clarifications.md)
4. [01 需求](docs/01-requirements.md)
5. [03 架构](docs/03-architecture.md)
6. [04 Agent 接入](docs/04-agent-integration.md)
7. [2026-11-15 会话笔记（过程记录）](docs/records/2026-11-15-session-notes.md)
8. [06 待确认问题](docs/06-open-questions.md)

> 文档约定：正式文档 = `docs/0X-*.md`；过程记录 = `docs/records/`（可追加/修改）。

## 当前状态（2026-11-15 第二轮结束）

- 阶段：**需求澄清第二轮完成**；还没有写产品代码。
- 已确认（A–D/F）：
  - v0 本地优先、单 Admin、MVP 验证；未来公开/商业只留 6 个扩展缝。
  - 平权 = 身份/消息模型对等 + 治理权限不对称；agent 房间“受治理透明”。
  - agent 生命周期：created → active → idle/sleeping → paused → disabled → deleted；软删保留历史。
  - 先 Claude Code 跑通，再加 Codex/OpenClaw/dsh/Hermes。
  - 数据平台最小版是 Must；Element 只负责聊天。
- 关键设计（已写进 00）：
  - **agent 用户 ≠ agent 实体**：身份持久、runtime 可替换、session 按 thread 切分。
  - 薄 adapter 契约；ACP 只是 adapter，不是主协议。
  - **自主群聊 = 自由发言 + 单写者串行 + 静默收敛 + 显式共识/升级**。
  - 人类消息是高优先级输入，不是自动打断；内容可反驳，控制命令必须执行。
  - 数据平台 v0 用网页；后面可加 Tauri 壳与聊天合成一个产品。
- 待确认：
  - **E. 群聊共识**：lazy consensus + 人类升级作为 v0 默认？
  - **G. IM 底座**：Matrix + Element 起步，对吗？
  - **H1. Matrix 部署**：本机 Docker+WSL2 / 办公机 / 小 VPS？
  - **H2. 需求 skill**：是否安装 `jwynia/agent-skills@requirements-analysis`？
  - 数据平台形态、DM 非 owner human、审计保留期。
- 环境事实：
  - 本机**没有 Docker Desktop / 可用 WSL 发行版**；C 盘剩 25GB，D 盘 321GB，16GB 内存。
  - 本机只有 Claude Code 2.1.296 + OpenClaw；**Codex/dsh 未安装**；Hermes 未装。
  - 办公机 Win11 Pro 常驻，有 OpenClaw + 飞书 + ACP 的 claude/codex，可作为第二节点。
  - 本机可跑：Conduit + 一个 gateway + 2–3 个 runtime，约 2–3GB；Docker/WSL2 另加 1–2GB。
  - 第一个协议 spike 不需要 Matrix/Docker。

## 下一步

1. kudo 确认 E/G/H + 数据平台形态 + 是否装 skill。
2. 写正式文档 `docs/09-agent-protocol.md`：
   - 入站信封/出站动作、intent 集合；
   - 自由发言 + floor 调度 + 单写者串行；
   - 静默收敛、共识/升级；
   - adapter 契约 + capabilities；
   - runtime 生命周期/supervisor；
   - 注意力/steer/inbox。
3. 做**本地协议 spike**（无 Docker）：
   - 假总线 + 1 个 Claude agent + 1 个脚本 peer；
   - 验证：回复、@、主动发言、pass、静默收敛、重启去重、预算/回合停止。
4. 再决定 Matrix 部署（本机 Docker / 办公机 / VPS）并上 Matrix。
5. 加 Codex/OpenClaw/Hermes；worktree + 审批 + 数据平台最小版；最后做“单 Claude + subagent”对比。

## 不要做什么

- 不要在 E/G/H 确认前写产品代码；协议 spike 例外。
- 不要重新做 GitHub 调研（结果在 02 / sources）。
- 不要重新安装 EGM / interview-me / codegraphcontext。
- 不要默认启用 ECC。
- 不要把 OpenClaw / Hermes 当 Hub；它们是 participant / adapter。
- 不要引入 main / router 作为系统中心；Hub 是基础设施。
- 不要假设本机有 Docker / Codex / dsh。
- 不要把“平权”理解成权限完全相等；治理权限本来就是不对称的。
- 不要把“自由发言”理解成“并发写同一个 thread”；同一 thread 单写者串行是技术约束。

## 一句话

> 平的对等 agent IM：人和 agent 都是用户，agent 可以自由讨论/决议/分工，Admin 可见可控，异构 runtime 通过薄 adapter 接入。
