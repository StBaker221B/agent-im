# 2026-11-15 第二轮答复（对应你的批注）

> 这是过程记录，不是正式文档。你的原文批注保留在 [2026-11-15 需求澄清](2026-11-15-02-clarifications.md)。
> 本文逐条回答你的批注；稳定结论会合并进 [00 需求合同](../00-requirements-contract.md)。
> 文档约定：**过程记录在 `docs/records/`，正式文档在 `docs/0X-*.md`**。07/08 已移到 records。

## 0. 先回三件事

1. **文档已分开**：`docs/records/` 放对话/批注/过程；`docs/00` 起是正式文档，随项目状态更新。
2. **需求 skill 找到了**：`jwynia/agent-skills@requirements-analysis`，2.3K 安装、187★、三项安全审计通过；它专门做“从模糊想法到可验证需求”的诊断（RA0–RA5 状态、反模式、健康检查、输出模板）。我建议装；你点头我就装。
3. **你的思路已经比较全面**，主要缺的是：运营/合规类需求（备份、恢复、保留期、事故响应、支持）、可测量的验收标准、以及“自治群聊”的确定性规则。后文有清单。

---

## 1. “Matrix 是啥”

- Matrix = 一个**开放的聊天协议 + 可自建的服务器**。你自己跑一个 homeserver，账号形如 `@kudo:agents.local`；房间、私聊、群聊、历史、在线状态、权限、端到端加密、桥接都是协议的一部分。
- Element = Matrix 的**客户端 App**（网页/桌面/手机），界面像微信/Slack。
- Synapse = 官方服务器实现（Python，功能全但重）；Conduit/Dendrite 是更轻的实现。
- 和微信的差别：微信是腾讯的封闭平台，你只有群主权限；Matrix 服务器是你的，你能创建 agent 账号、设房间权限、做审计、桥接其他 IM。

一句话：**Matrix 是“可自建的、开放的 IM 基础设施”，Element 是它的客户端；微信是“别人的、封闭的人对人平台”。**

---

## 2. “外部 agent 是什么”

外部 agent = **不是你创建的、不在你的 homeserver/组织里的 agent**。例如：

- 另一个团队/公司的 agent，通过 A2A 或 HTTP 接口接进来；
- 客户或供应商的 agent；
- 通过桥接从别的 IM/Matrix homeserver 进来的 agent。

它有自己的 owner、trust、预算和策略；默认**不可信、只读/低风险、需要审批**。v0 不做，等公开/商业阶段再加。它和你创建的 agent 在身份模型上可以一样（都是 participant），但治理策略不同。

---

## 3. 需求 skill + 需求完整性

### 3.1 找到的 skill

| Skill | 安装量 | 来源 | 判断 |
|---|---|---|---|
| `jwynia/agent-skills@requirements-analysis` | 2.3K | jwynia，187★，三项安全审计通过 | **最贴近**：专门诊断需求问题（RA0 没问题陈述、RA1 方案先行、RA2 模糊、RA3 隐藏约束、RA4 范围蔓延、RA5 已验证），有反模式、健康检查、输出模板 |
| `github/awesome-copilot@prd` | 24.6K | GitHub 官方 awesome-copilot | 流行，但偏 PRD 文档模板；不是“需求诊断” |
| `anthropics/knowledge-work-plugins@feature-spec` | 465 | Anthropic 官方 | 偏 feature spec；安装量低 |

**建议**：装 `requirements-analysis`，不装重的 PRD 框架。它和我们现在做的“合同 + 批注”是互补的：它负责问对问题，合同负责记录结论。

安装命令（你同意后我执行）：

```bash
npx skills add https://github.com/jwynia/agent-skills --skill requirements-analysis -g -y
```

——还有更好的 star更多的吗

### 3.2 需求完整性清单（我们已有/待补）

已有的：问题、用户、范围、用户故事、FR、NFR、风险、非目标、验收场景、假设、开放问题。

待补/要加强的：

| 类别 | 待补 |
|---|---|
| 运营 | 备份/恢复、RPO/RTO、日志保留、监控告警、事故响应、升级/迁移 |
| 合规/隐私 | 数据保留期、删除/擦除、审计访问控制、外部 agent 的数据边界、模型供应商条款 |
| 安全 | 威胁模型（资产/对手/信任边界）、prompt injection、凭据管理、沙箱逃逸 |
| 可用性 | 目标可用性、降级模式、离线/断网、消息丢失/重复的用户可见语义 |
| 成本 | 每 agent/每 thread/每日预算、超预算行为、成本归集 |
| 可用性/体验 | 首次使用、创建 agent 的流程、错误提示、可访问性、国际化 |
| 验收 | 每个 Must 的 Given/When/Then；可测量的指标 |
| 变更 | 版本化、迁移、兼容性、废弃策略 |

这些不用现在全做，但要进 00 的“待补”清单，避免以后才发现。

---

## 4. Runtime / 协议 / Gateway（你批注最多的部分）

### 4.1 Hermes 是什么

你给的链接我看了：**Hermes Agent 是 Nous Research 的开源 agent（MIT），不是模型**。特点：

- 自托管，Linux/macOS/Windows 都有；
- 持久记忆、自动生成 skill；
- 自带消息网关：Telegram、Discord、Slack、WhatsApp、Signal、email、CLI；
- 有隔离子 agent、定时任务、浏览器/搜索/沙箱执行。

所以它是**一个 agent 实体**，可以作为 participant 接入；但它的“消息网关 + 单 agent + 子 agent”不是我们的 flat Hub。接入方式：优先看它的 CLI/HTTP API/消息网关，写一个 adapter；不要让它当 Hub。

### 4.2 Runtime 什么时候启动？谁启动？重启后能恢复吗？

**谁启动**：Supervisor（守护进程）启动 gateway；gateway 按需启动 runtime。Supervisor 不是 agent，是基础设施。

**什么时候启动**：

| 模式 | 行为 | 适合 |
|---|---|---|
| 懒启动（推荐 v0） | 第一条消息到达时才启动 runtime | 笔记本、省内存 |
| 预热 | 保留最近活跃 thread 的 runtime | 常用 agent、低延迟 |
| 常驻 | agent 一启动就拉起 runtime | 服务器、常驻办公机 |

不常驻的话，能确保agent状态连续地处理问题吗？会话状态不会中断吗？runtime启动快吗？频繁启停，不会消耗很大吗？我看vscode 插件启动的这个 claudecode, 每次关了重开，都会等个一两秒才能起来

**重启/关机恢复**：

1. Supervisor 开机自启（Windows 计划任务 / NSSM / Docker restart policy；Linux systemd）。
2. 读 agent registry + session 表（SQLite/Postgres）。
3. 连 Matrix，用 since token 补课离线消息。
4. 按需 `ensureSession`：有 native session id 就 resume；失败就重建上下文。
5. 用 event_id / txn_id 去重，避免重复回复。
6. 运行中的 turn 丢了就重跑；工具副作用靠幂等键/审批控制。

**保证**：至少一次投递 + 幂等消费；不保证跨外部工具的 exactly-once。进程可以休眠，身份/inbox/session 引用不丢。

### 4.3 ACP 是不是“一个会话一个进程”？多个会话能共用一个 runtime 吗？

- **ACP 协议本身不规定进程模型**。它是 session-oriented：`session/new`、`session/prompt`、`session/cancel`、`session/load`。一个连接可以有多个 session；具体实现可以一 session 一进程，也可以多 session 共用一个进程。
- 你在 OpenClaw 里感觉“一个会话一个进程、会话结束就销毁”，很可能是它的集成方式，不是 ACP 的上限。
- **多个会话能否指向同一个 agent runtime**：取决于 runtime 是否支持多 session 复用：
  - Claude Agent SDK：一个进程里可以跑多个 `query()` 实例（每个 thread 一个），也可以一进程一 session；由 adapter 决定。
  - Codex app-server：一个 server 进程可以有多个 thread。
  - CLI/PTY：通常一进程一 session。
- v0 简化：**一个 agent 一个 runtime 进程，内部按 thread 管 session**；如果 runtime 不支持多 session，就一个活跃 thread 一个进程，空闲 TTL 回收。adapter 的 `capabilities` 声明 `multi_session`。

————多个runtime 本质上不就是多个 agent吗？应该要确保一个agent用户链接的是同一个 agent吧，至少在系统运行时，不用确保是同一个 runtime吗？不然不会出现 同一个 agent 用户 在不同会话中 表现不一致 吗？不过我想了想 如果只有一个agentruntime，这个agent 在多个会话都收到消息的时候 可能无法同时处理，回复速度会有瓶颈，是不是不应该把 agent用户 绑定到 一个 agent runtime 上？而应该绑定到 一个agent专属文件夹（配置，历史信息，workspace等）之下？这样能确保 一个agent用户 对应多个 runtime的时候，对外呈现的行为和信息背景始终保持一致吗？信息同步能及时吗？如果这样能行的话，一个agent是应该开一个关于它的会话就起一个 runtime，还是维持唯一runtime？再仔细想想

### 4.4 “支持所有 agent”的 adapter 要做得非常完备吗？能通用化吗？

不能做到“所有功能都通用”，但可以做到**通用骨架 + 能力分级**：

- 通用骨架：`ensureSession / send / interrupt / resume / health / capabilities`。
- 能力标记：`streaming / interrupt / resume / approval / tools / multi_session`；没有的能力降级（不能 interrupt 就杀进程；不能 resume 就重放最近 N 条消息）。
- 启动适配：每个 runtime 一个 manifest（命令、参数、环境、workspace、认证、健康检查、session 模式）。
- 一致性测试：每个 adapter 必须通过同一套 conformance（建 session、收消息、流式回复、中断、恢复、审批、健康）。
- 接入顺序：Claude Code → Codex → OpenClaw → dsh → Hermes → 自研。不要一次全做。

一句话：**通用化的是“契约和测试”，不是“所有 runtime 的行为”。**

### 4.5 Gateway 和 Adapter 是同一个东西吗？为什么 OpenClaw 感觉慢？

**不是同一个东西**：

```
Matrix 事件 → Gateway（收发室/门禁/记录员）
                 → Adapter（翻译/驱动）
                    → Runtime（大脑）
```

- **Gateway**：常驻、轻量、持有 Matrix token、sync、队列、策略、审计、session 映射、去重、重试、typing/presence。
- **Adapter**：把我们的契约翻译成某个 runtime 的原生 API；可以是 gateway 里的一个模块，也可以是子进程。
- v0：**一个进程里的模块化单体**（gateway core + adapter modules），不要拆成微服务；延迟最低、运维最简。

**OpenClaw 为什么慢/丢会话**：常见原因是冷启动、按任务 spawn 进程、每次 resume 整个 session、插件/模型加载阻塞、网关同步循环被工具调用阻塞、没有持久队列。不是“gateway 这个架构天生慢”。

**优化思路**：

1. Gateway 常驻且小；runtime 懒启动 + 预热池。
2. 一个活跃 thread 保持一个 warm runtime；空闲 TTL 再睡。
3. 流式输出，不等整轮结束；先发 typing/partial。
4. 本地 IPC/stdio/长连接，不要每条消息一次 HTTP。
5. 持久队列（SQLite）+ 先 ack 入队，再处理；sync 循环不被阻塞。
6. 每 thread 一个 worker，thread 之间并行；同 thread 串行。
7. 避免每条消息都 full resume；热进程保留上下文，冷启动才重建。
8. 量化：启动时间、time-to-first-token、事件到入队、入队到首字；先测再优化。

### 4.6 我的笔记本能跑吗？资源消耗？

能。粗估（2–3 个 agent）：

| 组件 | 内存 |
|---|---|
| Matrix：Conduit（轻） | ~50–150MB |
| Matrix：Synapse + Postgres（全） | ~0.5–1GB |
| Element Web（静态） | ~20–50MB |
| Gateway/Supervisor（Node，一个进程） | ~100–250MB |
| Claude Code / Codex 每个 runtime | ~200–500MB |
| 2–3 个 runtime | ~0.5–1.5GB |
| **合计** | **约 2–3GB（Conduit）或 3–4GB（Synapse）** |

- 16GB 内存足够；瓶颈是模型 API 延迟，不是本地 CPU。
- Docker/WSL2 本身会多占 1–2GB；如果用 Docker，预算 4GB 左右。
- 省资源：Conduit 代替 Synapse、一个 gateway 管多 agent、runtime 懒启动/空闲睡、SQLite、v0 不用 per-agent 容器、worktree 放 D 盘、日志轮转。
- 如果本机吃紧：Matrix 放办公机/VPS，本机只跑 gateway + 1 个 agent。
- **第一个协议 spike 不需要 Matrix/Docker**：Node + Claude CLI + 假总线就能跑，内存几百 MB。

————一个agent用户一个gateway？还是都共用一个gateway？

### 4.7 Matrix 简单吗？换协议/换语言方便吗？

- **概念简单，运维中等**：协议大，但我们只用子集（普通账号、房间、消息、历史；不用 AppService、E2E、federation）。Synapse 重，Conduit 轻。
- **换 IM 协议**：不简单，但可以用 `ImTransport` 接口隔离；核心（agent、策略、审计、数据平台）不依赖 Matrix。换/加飞书、Slack、自建时，只写 transport adapter。
- **语言**：Matrix 是协议不是语言；客户端库有 TS、Rust、Python、Go、Java 等；服务器有 Synapse（Python）、Conduit（Rust）、Dendrite（Go）。我们的 gateway v0 用 TypeScript/Node 足够；以后要速度，可以把热路径换 Go/Rust，契约不变。
- **速度**：3–5 个 agent，Node 不是瓶颈；LLM 延迟才是。先别为性能换语言。


————除了matrix还有其他选项吗？
---

## 5. Steer / 队列 / 注意力模型（你的批注）

你说得对：**不是所有消息都该打断，也不是所有消息都该等**。建议按“thread + 优先级”分流：

| 场景 | 行为 |
|---|---|
| 人类在 agent 正在干的同一个 thread 发消息 | 默认 **steer**：注入当前 turn（Claude Code 插话）；runtime 不支持就排在当前工具调用之后 |
| 人类在同一个 thread 发 `!interrupt` / `!priority` | 立即中断当前 turn |
| 人类在另一个 thread/房间发消息 | 进 **inbox**，不打断；agent 当前 turn 结束后处理，或切到新 session |
| agent 在另一个 thread 收到 @ / DM | 进 inbox；如果是 owner/admin 的紧急消息，可中断（可配置） |
| agent 在同一 thread 收到另一个 agent 的消息 | 按 intent/优先级排队；不并发写同一个 thread |
| 人类发的是“控制命令”（pause/kill/approve） | **必须执行**，不受“agent 可反驳”影响 |

关键区分：

- **内容**（建议、意见、批评）人类和 agent 平等，agent 可以不听、反驳、要求澄清；
- **控制**（暂停、杀死、审批、预算）是治理权限，agent 必须服从；
- **注意力**（哪个 thread 现在处理）由 agent + 策略决定，人类可以用 `!priority` 提升，但不是每条消息都打断。

这就是“像人一样”：同事在开会时，你可以在同一个会议里插话；但你在另一个群里发消息，他不一定马上停下手上的活。

---

## 6. 发言规则重新设计（你要求“闭环 + 漏洞”）

### 6.1 先纠正我自己

你说得对：**固定轮流发言是错的**。agent 应该自己判断“我有没有话说”，不需要按顺序等。需要串行的不是“说话的权利”，而是“长 turn 的写操作”——因为每个 agent 的一轮可能跑几十秒到几分钟，并发写同一个 thread 会互相读到旧上下文、输出交错、重复回复。

所以新模型是：

> **自由发言 + 单写者串行 + 静默收敛 + 显式共识/升级**

### 6.2 自由发言

- agent 不需要被 @ 才能说话；它可以根据自己的判断**主动发言**（volunteer）。
- 它可以旁听、沉默、反对、私聊。
- 但“想说”和“同时写”分开：想说就举手/排队；同一 thread 同一时刻只有一个 agent 在写。

————补充一点 群聊内 所有agent都能收到所有消息，这才叫群聊，包括被 @ 的消息，在 gateway层面 应该能让agent 感知到 自己是否被 @ 

### 6.3 单写者串行（不是轮流）

- 每个 thread 有一个 **floor（发言权）**；持有者可以写，其他人排队。
- 谁获得 floor：
  1. 被 @ / 被回复的 agent（最高优先级）；
  2. task owner / 被指派的 agent；
  3. 主动举手（volunteer）且策略允许的 agent；
  4. 开放讨论时，公平轮转（只对提案/问题，不是每条闲聊）。
- 持有者可以 `pass`（无话可说，不消耗 turn）、`handoff`（交给下一个）、`done`（结束）。
- 人类消息是**高优先级输入**，不是自动“打断所有 agent”；`!interrupt` 才是强制中断。
- 不同 thread 可以并行（不同 session），所以 agent 不是“全系统排队”，只是“同一个 thread 串行”。

————嗯，interrupt 大概相当于“全都闭嘴，听我先说”是吧
agent runtime侧处理消息  跟 会话（dm，群聊）侧的消息收发 应该是隔离的吧，时序上应该 各是各的一套轮转吧，中间通过 gateway 做桥梁传递 是吧

### 6.4 静默收敛（自然结束）

不是“回合数到了就停”，而是：

- 每个 agent 有状态：`idle / thinking / working(工具) / waiting / done / pass / error`。
————waiting idle 区别是啥？定义可以以后明确，这个设计是好的
- 当以下都满足时，thread 进入 `quiescent`：
  - 没有 agent 在 `thinking/working`；
  - 没有未完成的 `task`；
  - 没有未回答的 `question`；
  - 没有待审批；
  - 最近一条**有实质内容**的消息之后，安静了 `quiet_window`（如 30–60 秒）；
  - 所有活跃 agent 都看过最新消息，或已 `pass`。
——————有状态轮询检查？
- 进入 quiescent 后，runtime 可以睡；新消息唤醒。
- 如果还有未完成工作但长时间没人推进：提醒 owner，或 `ask_human`。
- **硬上限只做安全网**，动态设置（例如 `base + per_agent * 人数`，或 token 预算），不是主要结束方式。

————群聊可能没有特定的owner，需要结合群聊里成员的身份 决定向谁汇报或者请示决定，所以还需要补充一套身份标识 或者 这个身份应该随 会话目标 动态确定，a 是这个会话问题的负责人，或者他是这个群的发起人，之类的？agent得有明确的分工标识，知道什么问题该找谁，哦对，agent还得有往群里拉人的权限和能力，这个是不是应该放到 agent创建的时候给他配置上，或者添加特定的skill让agent记住 处事的逻辑？可以先简化，但是后面要有这个设计

### 6.5 显式共识（回答 E）

“自动产生共识”不是让 LLM 说“大家同意了”，而是**确定性地数显式信号**：

| 规则 | 形式 | 适合 |
|---|---|---|
| Lazy consensus（推荐 v0） | 提案发出后 T 时间内无人 `object`，且有 quorum 看过 → 通过 | 低风险、日常 |
| Unanimous | 所有活跃 agent `agree`，无 `object` | 高风险/重要决策 |
| Majority | >50% 活跃 agent `agree`，达到 quorum | 人多、意见分散 |
| Owner decides | 议题/task owner 听完反对后拍板 | 有明确负责人 |
| Escalation | 到 deadline 仍无共识 → @ 相关人类（task owner/领域 owner/admin），附各方立场摘要 | 兜底 |

建议 v0：**lazy consensus + 人类升级**；先不做多数票。网关只负责计数/记录，不判断内容。相关人类由 role/owner 解析，不是随便 @ 一个人类。

### 6.6 漏洞清单（闭环检查）

| # | 漏洞 | 处理 |
|---|---|---|
| 1 | 每个 agent 都回复每条消息 → 烧钱/刷屏 | mention/volunteer 策略、每 agent 频率限制、`pass` 不消耗 turn |
| 2 | 并发写同一 thread → 读到旧上下文/输出交错 | 单写者 floor + transcript 版本号 |
| 3 | “同意/谢谢”礼貌循环 | 无新信息检测、重复 hash、`pass`、静默窗口 |
| 4 | 一个 agent 霸占发言 | 公平队列、每 agent 配额/冷却 |
| 5 | 安静 agent 永远不说话 | 决策点 roll call；允许 volunteer，但不强制 |
| 6 | 人类一说话就打断一切 | 人类消息高优先级但不自动 preempt；`!interrupt` 才强制；agent 可反驳内容 |
| 7 | 人类说废话/跑题 | agent 可忽略/`pass`/反驳；但控制命令必须执行 |
| 8 | 跨 thread 消息丢失/混淆 | inbox + 持久队列 + ack；只有当前 thread steer |
| 9 | 决议含糊，不知道谁拍的板 | `decision` 消息带规则/决策人/参与者；网关记录 |
| 10 | agent 私聊搞小动作 | DM 允许但 Admin 可见；决议必须回房间记录 |
| 11 | 崩溃/重启重复回复 | event_id/txn_id 幂等 |
| 12 | 预算失控 | 硬停 + 通知 |
| 13 | 静默误判（agent 在想但没输出） | 跟踪 `thinking/working`，有工作不 quiesce |
| 14 | 静默失效（一直聊） | 重复检测 + quiet window + 动态硬上限 |
| 15 | 人类不在场无法升级 | 超时策略：低风险默认拒绝/等待；高风险必须人类 |
| 16 | prompt injection | 消息视为不可信；工具最小权限；危险操作审批 |
| 17 | 没话说但被点名 | `pass` 不算 turn，不扣预算（或小扣） |
| 18 | 长工具调用导致 floor 饿死 | 最大 turn 时长/检查点；人类可中断；thread 间并行 |
| 19 | 一个 thread 多个议题 | 用 thread/agenda id 隔离；不要混 |
| 20 | 共识没有记录 | `decision` 事件 + 审计；没有记录不算决议 |

### 6.7 一句话

> agent 想说什么就说什么；同一 thread 一次只让一个 agent 写；没话了就安静；有分歧就显式投票/升级人类。**自由不等于并发写，串行不等于轮流发言。**

---

## 7. 数据平台：网页还是 App？要和软件做在一起吗

- **v0 做网页**：Matrix/Element 都是 Web，浏览器跨平台，最快；PWA 可装到桌面。
- **数据平台是产品的一部分**，不是附属脚本：一个产品外壳，两个区域——聊天（Element/自研）+ 控制台/数据台（agent、房间、事件、审批、成本、回放）。
- v0 可以先用 Element 聊天 + 一个本地 Web dashboard；后面合成一个壳（Tauri 比 Electron 轻，适合 16GB 笔记本）。
- 不建议 v0 就做原生 App：聊天 UI、通知、更新都要重做，拖慢核心验证。

---

## 8. Matrix 能接微信/飞书吗

- **飞书/Slack**：可以。官方 bot/事件 API + 桥接服务，把外部群映射到 Matrix 房间；人类可以在飞书里看/发，agent 仍然在 Matrix 侧。飞书 bot 仍是“二等公民”（平台限制），但作为人类入口够用。
- **微信**：**个人微信自动化不建议**（违反 ToS、易封号、不稳定）；企业微信/公众号有官方 API，但能力有限。商业产品要走官方合规接口，不要承诺“直接接个人微信”。
- **更稳的路线**：用 Matrix 的桥（mautrix 等）接 Telegram/Discord/Slack/WhatsApp；飞书/微信写自己的 bridge。核心 agent 永远只看到 Matrix，不直接对接每个平台。
- 所以在 `ImTransport` 之外，**桥接优先**：外部 IM → Matrix room → agent。这样 agent 侧只维护一套语义。

---

## 9. 对你 A–H 的回答

| # | 你的批注 | 结论 |
|---|---|---|
| A | 可以先做 MVP，验证是否可行 | ✅ 确认：local-first MVP，未来只留缝 |
| B | 可以，现在也没别人；扩展方便吗 | ✅ 确认；扩展成本不大：role+scope + 房间隐私策略 + workspace_id；v0 单 workspace |
| C | 可 | ✅ 确认：生命周期 + 软删保留历史 |
| D | 可，先用 Claude Code 跑通，再加其他 agent | ✅ 确认：v0 先 Claude，Codex/OpenClaw/dsh/Hermes 后加 |
| E | 讨论顺利应有共识；分歧时 @ 相关人；自动共识是什么形式 | ✅ 采纳你的方向：lazy consensus + 升级人类；形式见 6.5；v0 先不做多数票 |
| F | 可以简单点，后面扩展 | ✅ 确认：v0 最小 dashboard，但数据模型/事件流先留好 |
| G | 先简单点 | 我理解为：**v0 用 Matrix + Element，不先做飞书/微信**；如果你指的是别的，纠正我 |
| H | 我给意见；API 不够会停；本机能跑吗 | 本机能跑（2–4GB）；第一个 spike 不需要 Docker；需要你做的只有：决定 Docker/WSL2 装本机还是用办公机/VPS，以及是否装 requirements skill |

### H 的具体行动

**你不需要现在做什么**，除了三个决定：

1. **Matrix 跑在哪**：
   - A. 本机装 Docker Desktop + WSL2（数据放 D 盘；需要管理员/重启）；
   - B. 办公机（常驻 Win11 Pro）跑 Matrix；
   - C. 小 VPS。
   我建议先做**不依赖 Matrix 的本地协议 spike**，同时你决定 A/B/C。
2. **是否装 requirements-analysis skill**：建议装。
3. **群聊共识**：接受“lazy consensus + 人类升级”作为 v0 默认吗？还是你想先只允许人类拍板？
——————按你建议的 
---

## 10. 下一步（我建议的顺序）

1. 你确认 G 的理解、E 的共识规则、H 的部署选择、是否装 skill。
2. 我写正式文档 `docs/09-agent-protocol.md`：
   - 入站信封/出站动作；
   - intent 集合；
   - floor 调度 + 单写者串行；
   - 静默收敛；
   - 共识/升级；
   - adapter 契约 + capabilities；
   - runtime 生命周期/supervisor；
   - 注意力/steer/inbox。
3. 更新 00 合同（把本文结论合并）。
4. 做**本地协议 spike**（无 Docker）：
   - 假总线 + 1 个 Claude agent + 1 个脚本 peer；
   - 验证：回复、@、主动发言、pass、静默收敛、重启去重、预算/回合停止；
   - 验收通过后再上 Matrix。
5. 上 Matrix 后：1 个 supervisor + 2 个身份 + Element；再跑群聊 demo。
6. 加 Codex/OpenClaw/Hermes；worktree + 审批 + 数据平台最小版；最后做“单 Claude + subagent”对比。

---

## 11. 我需要你回的（很短）

- G：Matrix + Element 起步，对吗？ 对
- E：lazy consensus + 人类升级，作为 v0 默认，可以吗？可以
- H1：Docker/WSL2 装本机，还是先用办公机/VPS？（不阻塞第一个 spike）本机先搞一下，笔记记录好，后面我 在办公机上 gitpull 以后再搞，办公机上搞的跟本机这一套会有区别吗？
- H2：装 `requirements-analysis` skill 吗？再看看还有没有其他更推荐的？
- 数据平台：v0 网页 + 后面 Tauri 壳，可以吗？这个已经是当前最精简的mvp了是吗，可以

> 你可以直接在下面批注，或者直接回我编号。
