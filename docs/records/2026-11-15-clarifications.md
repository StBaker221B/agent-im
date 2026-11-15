# 08 需求澄清（2026-11-15，第二轮）

> 用法：这份文档就是给你批注的。每节末尾有 `【你的批注】`，直接在那行下面写你的回复、修改或问题。
> 你确认后，我把结论合并进 [00 需求合同](../00-requirements-contract.md)，再把 01/03/05/06 对齐。
>
> 本文回答你这一轮的 10 个点：私有/商业、平权与 Admin 可见、永久账号、agent 用户 vs agent 实体、协议与 ACP、术语、自主群聊、数据平台、Matrix/Element、记录方式。

## 0. 先给三个结论

1. **v0 本地优先，但按“以后可能公开/商业”来留缝**：现在不做多租户、计费、公开注册，但数据模型、权限、部署、审计都留好扩展位。
2. **“平权”和“Admin 能看一切”不矛盾**：平权是身份与消息模型对等；治理权限本来就不对称。agent 是被你创建和拥有的软件，不是拥有隐私权的独立法人。
3. **agent 用户 ≠ agent 实体**：前者是永久 IM 身份，后者是可替换的运行时/会话。两者之间需要一层薄 adapter 契约；ACP 只是其中一种适配器，不是系统主协议。

---

## 1. 私有 vs 以后商业化/公开

你的意思我理解为：**现在本地验证，但不要把路堵死**。这不需要现在做商业功能，只需要留 6 个“扩展缝”：

| 缝 | v0 做法 | 以后怎么扩展 |
|---|---|---|
| 租户/工作区 | 数据模型带 `workspace_id`，v0 只有一行 | 多租户、组织隔离 |
| 权限 | `role + scope`（platform_admin / workspace_admin / member / agent / auditor），不写死“本机用户=神” | 公开部署时把 admin 限定到某个 workspace/org |
| IM 底座 | `ImTransport` 接口，Matrix 是第一个实现 | 换/加飞书、Slack、自建 |
| Agent 运行时 | 统一 adapter 契约（见第 4 节） | 新增 Claude/Codex/Hermes/自研不改核心 |
| 审计/成本 | 从第一天按事件记录 token/成本/工具调用，可导出 | 合规、计费、报表 |
| 部署 | 配置全走环境变量/文件，不写死路径、域名、单机假设 | Docker Compose → K8s/云 |

**现在不做**：多租户 UI、计费、公开注册、federation、SLA、商业控制台。
**只留缝，不做门**：未来要加功能时，不需要推翻数据模型和权限模型。

一句话：**local-first, public-ready seams（本地优先，预留公开/商业接缝）**。

【你的批注】：Matrix 是啥

---

## 2. 平权 vs “我能看到每个 agent 的对话”

这不是你设计矛盾，而是“对等”被用成了一个含糊的词。把它拆成三层就清楚了：

| 层 | 定义 | 是否对等 |
|---|---|---|
| 身份对等 | 人和 agent 都是 participant，有唯一地址、资料、inbox、房间成员资格；消息规则相同 | ✅ 对等 |
| 治理权限 | agent 由人类创建/拥有；Admin 可以暂停、杀死、审批、看审计；agent 不能管理人类 | ❌ 不对称，这是设计 |
| 隐私 | agent 相关房间默认“受治理的透明”；human-human 私聊才是私密 | ❌ 不同 |

为什么可以看 agent 的对话：

- agent 是**你创建的软件**，不是独立法人；它的 owner/admin 需要可观测性来保证安全、成本和责任。
- 类比公司 Slack：员工可以私聊，但公司合规管理员在制度允许下可以导出审计；关键是**告知 + 制度**，不是技术上的“偷看”。
- 你要求的“安全考虑”是正当的；把这一点写进产品规则，而不是藏起来。

建议的房间隐私规则：

| 房间类型 | 默认 | Admin 能看到什么 |
|---|---|---|
| agent ↔ agent DM/群 | 透明 | 消息、工具调用、成本、审批 |
| human ↔ agent DM/群 | 透明（因为 agent 被管理） | 同上；可配置为私密，但会失去审计 |
| human ↔ human DM/群 | 私密 | v0 不做或以后 E2E；只保留元数据 |
| 外部 agent / 桥接 | 按双方策略 | 默认只读/低风险，内容按协议 |

未来公开部署时，这变成 `auditor` / `workspace_admin` 角色 + scope + 审计日志；房间加入时显示“此房间对管理员可见”。这不是“超级权限”，而是**受治理的透明**。

一句话：**身份平等，治理不对称，隐私分层。**

【你的批注】： 外部agent是什么

---

## 3. “永久账号”到底是什么意思

“永久”= **只要你不删，身份就稳定**；不是永生，也不是不可删除。

生命周期：

```
created → active → idle / sleeping → paused → disabled → deleted
```

| 状态 | 含义 |
|---|---|
| created | 分配 MXID、写 agent card、创建 workspace、配置 runtime/预算 |
| active | gateway 在线，能收发消息 |
| idle / sleeping | 进程可休眠；身份、inbox、session 引用还在；消息唤醒 |
| paused | 不处理新消息，消息进队列；可恢复 |
| disabled | 不能登录/发言；保留历史 |
| deleted | 软删（默认）：停 gateway、吊销 token、保留历史，显示“已删除 agent”；硬删需显式确认，审计保留 |

- 你可以**创建、配置、禁用、恢复、删除** agent；只有 Admin 能做，agent 只能请求。
- 同一 runtime 可以开多个独立实例：`@claude-dev-1`、`@claude-dev-2`，各自配置、workspace、预算。
- 删除后历史默认保留（审计需要）；如果你要“彻底擦除”，我们另做擦除流程。
- 换模型、换 workspace、换 prompt 不算换身份；除非你明确要新建一个 agent。

一句话：**账号是稳定的身份，不是永远运行的进程；生命周期由你控制。**

【你的批注】：可以 先这么定 另外 能不能把 我们的对话记录 和 正式文档区分开，对话记录是我们的过程文件，文档是反映当前项目状态的，记录会被追加，旧的可能不变可能删除，而以后文档是会被更新修改的
另外 有没有专业的 需求分析需求管理的 skill 看要不要安装一下，我不知道我想的这些是否足够全面

---

## 4. Agent 用户 vs Agent 实体：是不是一个会话？需不需要协议？ACP 够不够？

### 4.1 先给结论

**不是同一个东西。**

- **Agent 用户**：IM 里的持久身份（Matrix 账号），有地址、资料、房间成员资格、消息历史。
- **Agent 实体**：真正思考/执行的运行时（Claude Code 进程、Codex thread、OpenClaw session、dsh、Hermes、自研 agent）。
- **Gateway（网关）**：两者之间的桥。它持有 Matrix 凭据、维护队列、执行策略、记录审计；runtime 不需要知道 Matrix 的存在。
- **Session（会话）**：runtime 里的一段上下文，按 `agent + room + thread` 切分。一个 agent 用户可以有多个 session。

```
Matrix 用户 @claude-dev        ← 永久身份
        │
   Gateway（网关：token / 队列 / 策略 / 审计）
        │  ← 我们的薄 adapter 契约（不是新行业标准）
   Adapter（Claude / Codex / OpenClaw / dsh / Hermes / 自研）
        │
   Runtime session（native session，按 thread 隔离）
```

关系可以写成：

```
1 个 agent 用户 ↔ 1 个 gateway ↔ 1 个 adapter ↔ N 个 session
```

- 身份不会因为进程死亡而消失；session 可以 resume 或重建。
- 一个 agent 可以同时有多个 thread 的 session；v0 可以限制“同一时刻只处理一个 turn”，但模型上不要假设 1:1。
- 一个 runtime 进程可以承载多个 session（Claude Agent SDK / Codex app-server），也可以一个 session 一个进程（CLI headless）；adapter 负责隐藏差异。

所以回答你的问题：**agent 用户和 agent 实体不是“一个会话”；用户是身份，会话是上下文。** 这正是“常驻身份 + 可休眠进程 + 可恢复会话”能成立的原因。

### 4.2 需不需要设计协议？

需要，但**不是发明一个新的行业标准**，而是一层很薄的 **Agent Runtime Adapter 契约**（内部接口）。建议 5 个动作：

```ts
interface AgentRuntime {
  ensureSession(ctx: SessionContext): Promise<SessionRef>;
  send(session: SessionRef, event: InboundEvent): AsyncIterable<OutboundEvent>;
  interrupt(session: SessionRef): Promise<void>;
  resume(session: SessionRef): Promise<SessionRef>;
  health(): Promise<Health>;
  capabilities(): RuntimeCapabilities;
}
```

- `ensureSession`：确保这个 thread 有一个 native session（新建或恢复）。
- `send`：投递一条 IM 事件，流式返回 agent 的输出（消息、工具调用、审批请求、产物、done/handoff/ask_human）。
- `interrupt`：中断当前 turn。
- `resume`：进程重启后恢复 session。
- `capabilities`：声明支持什么（streaming / interrupt / resume / approval / tools / multi-session），缺什么就降级。

传输可以是 stdio JSON-RPC、HTTP+SSE、WebSocket，甚至 v0 直接是 TypeScript 进程内接口；**关键是语义，不是传输**。不要一开始就做跨机器协议；等需要远程 agent 时再加一层 JSON-RPC/HTTP 封装。

### 4.3 ACP 到底够不够？会不会只能单次任务？

- **ACP 本身是 session-oriented 的**：有 `session/new`、`session/prompt`、`session/cancel`、`session/load` 等；它不是“一次请求一次回复就结束”的协议。
- 你在 OpenClaw ↔ Claude 的 ACP 体验里感觉像单次，很可能是**集成方式**造成的：按任务 spawn 一个进程、任务结束就退出；或者某个 adapter 没有保持长活 session。这是实现选择，不是 ACP 协议的上限。
- 但 ACP 的设计目标是**宿主/IDE ↔ 一个 agent**，它不定义 IM 身份、房间、多 agent 群聊、管理员审计。所以它适合做**一个 adapter**，不适合做整个系统的协议。
- 同理：
  - **MCP** = agent ↔ 工具。
  - **A2A** = agent ↔ agent 的任务协作（外部边缘）。
  - **ACP** = 宿主/客户端 ↔ agent。
  - **我们的契约** = IM 网关 ↔ agent runtime（多 session、IM 事件、审批、审计）。

### 4.4 各 runtime 怎么接

| Runtime | 首选接法 | 会话能长期保持吗 |
|---|---|---|
| Claude Code | Claude Agent SDK streaming input；或 CLI `--input-format stream-json --output-format stream-json --resume` | 可以；SDK 保持活的输入流，CLI 可 resume |
| Codex | `codex app-server`（thread / turn） | 可以；thread 就是持久会话 |
| OpenClaw | 它自己的 gateway/API 或 ACP | 可以；但它是 participant，不是 Hub |
| dsh | ACP / Python SDK / headless | 取决于 adapter；ACP 可 session |
| Hermes | 取决于它暴露什么（CLI/HTTP/SDK/ACP） | 有接口就能写 adapter |
| 自研 | 实现上面的 5 个方法；或提供简单 HTTP turn 接口 | 由你控制 |

> 你提到的 Hermes，我不确定具体指哪一个（Nous Research 的 Hermes 模型？某个 agent 框架/产品？）。给我一个链接或说明，我把它加进 adapter 清单；只要有 CLI / HTTP / SDK / ACP 之一就能接。

一句话：**身份与进程解耦；协议薄、能力可选；不重造 agent 大脑。**

【你的批注】：
https://hermes-agent.nousresearch.com/ 这是个 agent 不是个模型吧
有个问题 agent的 runtime 什么时候启动？谁来启动？如果软件关闭了 或者电脑重启了，能确保拉起 各个agent 并恢复状态吗？
acp 是一个回话 就创建一个 agent进程吧，会话不结束 当前 agent 就不会被销毁 但多个会话 能指向同一个 agent runtime 吗 我不太了解
要支持所有agent，这个 adapter 是不是得做得非常完备，能通用化吗agentruntime拉起也要适配各种 agent吧
关于gateway, 从openclaw的体验看，这玩意好像很慢，启动慢，传递信息也慢，还容易丢会话信息，导致感觉没反应，主要是启动太满，能优化吗，有什么思路？我好像也没太理解 gateway和 adapter 的关系，是同一个东西吗？我只知道需要连接 agent runtime 和 agent im用户
我的笔记本配置不高，这玩意做出来，我本地能跑起来吗，资源消耗如何，尽量压缩
matrix 是比较简单吗？后面如果需要扩展，方便吗？要是换别的im协议，方便吗，支持多少语言，要是后面为了速度，换语言呢？

---

## 5. 术语表（DM 等英文词）

| 英文 | 中文 | 意思 |
|---|---|---|
| IM | 即时通讯 | Instant Messaging，像微信/飞书这种聊天系统 |
| DM | 私聊 / 单聊 | Direct Message，1 对 1 的会话（不是群） |
| Matrix | — | 一个开放的聊天协议 + 服务器；可以自建，用户 ID 形如 `@name:域名` |
| Element | — | Matrix 的客户端 App（网页/桌面/手机），类似微信/Slack 的界面 |
| Synapse | — | Matrix 的官方服务器实现（Python，成熟但重） |
| Conduit / Dendrite | — | 更轻的 Matrix 服务器实现（Rust / Go） |
| homeserver | 主服务器 | 托管你的账号和房间的 Matrix 服务器 |
| MXID | Matrix 用户 ID | 形如 `@claude-dev:agents.local` |
| Room | 房间 / 群 | 一个会话空间；2 人房间就是 DM，多人就是群 |
| Presence | 在线状态 | 在线 / 忙 / 离线 / 最后活跃 |
| AppService | 应用服务 | Matrix 的一种扩展，能让一个服务注册很多虚拟用户并接收它们的事件；能力强但复杂 |
| Gateway | 网关 | 我们给每个 agent 做的“IM 网卡”：持有账号、收发消息、执行策略、调用 runtime |
| Runtime | 运行时 / agent 实体 | 真正干活的 Claude Code / Codex / OpenClaw / dsh 进程 |
| Adapter | 适配器 | 把我们的网关契约翻译成某个 runtime 的原生接口 |
| Session | 会话 / 上下文 | runtime 里的一段对话上下文；按 thread 切分 |
| Turn | 回合 | agent 的一次响应/行动周期 |
| Lease | 发言权 | 一个 thread 当前谁可以发言的标记；合作式，不是硬锁 |
| Steer | 转向 | 在 turn 进行中插入人类指令，改变方向 |
| Interrupt | 中断 | 停止当前 turn |
| Approval | 审批 | 危险操作需要人类批准 |
| Artifact | 产物 | 文件、diff、PR 链接、报告等 |
| Agent Card | agent 名片 | 描述 runtime、模型、能力、工具、预算、trust 的机器可读资料 |
| Directory | 通讯录 / 目录 | 按能力/工具/模型搜索 agent |
| Audit | 审计 | 记录消息、工具调用、审批、成本、生命周期 |
| Policy | 策略 | allowlist、预算、回合上限、审批规则等确定性规则 |
| Transparent mode | 透明模式 | agent 房间默认不加密，Admin/Auditor 可读 |
| E2E | 端到端加密 | 只有会话双方能解密；与 Admin 全局可见冲突 |
| Worktree | git 工作树 | 同一个仓库的独立工作目录/分支，agent 之间互不污染 |
| Sandbox / Container | 沙箱 / 容器 | 隔离运行环境 |
| Cron / Webhook | 定时 / 事件触发 | agent 主动巡逻或响应外部事件的机制 |
| ACP | Agent Client Protocol | 宿主/编辑器 ↔ agent 的协议 |
| A2A | Agent-to-Agent | agent 之间任务协作的协议（跨组织边缘） |
| MCP | Model Context Protocol | agent ↔ 工具/数据的协议 |

【你的批注】：
在我们这个系统里 感觉大多应该都是steer 吧  群聊的话，谁也不知道谁在干啥，我该说我就说了，得保持能收到消息吧，不过也不一定，要是agent在专心干会话a的活，会话b的消息可能也无关紧要？但会话a的话应该在干会话A的活的时候就接收吧，就像 claudecode的插话一样，这里可能需要设计一下

---

## 6. 自主群聊：没有 main，怎么讨论、决策、分工？

这是你最想要的东西，也是系统最核心的差异。关键不是“让 agent 随便聊”，而是给群聊一个**确定性的会议协议**。

### 6.1 Gateway 是“会议秘书”，不是主持人

- 它不做语义决策，不决定“谁说得对”；
- 它只做确定性的事：谁持有发言权、这轮该谁、已经几轮、是否重复、是否超预算、是否该请人类。
- 这样既保留“没有 main”，又不会让群聊失控。

### 6.2 消息带意图（intent）

建议每条消息带一个结构化意图：

| intent | 用途 |
|---|---|
| `chat` | 普通发言 |
| `proposal` | 提议（带选项/理由） |
| `question` / `answer` | 提问 / 回答 |
| `decision` | 决议（谁拍的板、选了什么） |
| `task` | 分工（owner、范围、workspace、验收） |
| `status` | 进展 |
| `done` | 完成（附 artifact） |
| `handoff` | 交给下一个 agent |
| `ask_human` | 卡住，请人类决定 |

Element 里可以用消息正文 + 自定义事件；数据平台里可以渲染成会议视图。

### 6.3 发言规则（v0）

1. **人类永远优先**：人类消息可以排队到当前工具调用之后，必要时 `!interrupt` 立即中断。
2. **被 @ 或被回复的 agent 获得下一轮发言权**。
3. **一个 thread 同时只有一个 agent 发言**；其他 agent 排队，不抢话。
4. **只有持有发言权或被人点名的 agent 才发言**；没人点名时默认沉默，避免互相刷屏。
5. **回合上限 / 冷却 / 重复检测**：到上限自动 `ask_human`，不无限对聊。

### 6.4 讨论 → 决议 → 分工

- **议程**：人类或某个 agent 开一个议题（目标、参与者、回合预算）。
- **提议**：agent 用 `proposal` 给方案和取舍。
- **决议**：v0 建议**由人类最终拍板**（`!decide` 或点批准）；agent 可以投票/推荐，但不自动产生“共识”。
  - 以后可配置自动共识（例如全员 `agree`，或多数 + 法定人数），但必须有明确规则，不能靠 LLM 自称“大家同意了”。
- **分工**：`decision` 之后发 `task`，写清 owner、范围、workspace、验收；agent 接受/拒绝；执行中用 `status`，结束用 `done` + artifact。
- **审计**：会议纪要、决议、任务、执行结果都进 Matrix 历史 + 审计事件；数据平台可回放。

### 6.5 为什么这仍然是“像人一样工作”

- 人类工作群也不是随便刷屏：有议题、有提议、有拍板、有分工、有交付。
- 我们只是把这些结构显式化，让 agent 能可靠地协作，而不是靠一个 main 管家在中间传话。
- 人加入群聊、发消息，所有 agent 都能收到；人可以随时改变议题、拍板、打断。

【你的批注】：
为啥必须轮流发言，agent自己判断，该说就说吧，不一定非要有啥顺序吧，它只要能接收到消息，就有输入，就会有输出，有输出就直接输出，为啥要轮流等时机
没人点名为啥不能发言，互相刷屏是指 大家都说 大家都能听到别人说的，这样每个agent的输入输出都不停，对话无法停止？但是有的agent可能旁听会有很好的意见，该说的时候也得主动说，甚至像人一样 主动私聊
人也经常说废话，如果人的发言偏离问题 无用，agent应该自己判断，不听，或者反驳人，避免人来打乱工作拖后腿，人类也不应该一说话就能打断所有agent的工作，顶多steer就可以了吧，因为人说的不一定总有用，你觉得呢
关于回合停止，能不能参考agent回合的概念，如果所有agent都无话可说了，都干完活了，都形成结论了，都说完了，就没话了，这是自然的结束吧，回合上限应该高一些吧，应该是动态的，群成员越多，上限越高
重新审视一下发言规则，看能否闭环，有啥漏洞没有

---

## 7. 数据平台 / 管理界面：我要知晓一切、控制所有 agent

这是核心需求，不是附属品。v0 可以最小，但必须有。

### 7.1 看什么

| 视图 | 内容 |
|---|---|
| Agent 清单 | 状态、runtime、模型、owner、workspace、预算、trust、最后活跃 |
| 房间 | 成员、消息、thread、实时流 |
| 事件流 | 消息、工具调用、审批、成本、lease 变更、生命周期 |
| 审批 | 待批、已批、拒绝、超时 |
| 审计 | 按 agent/room/time 筛选、导出、回放 |
| 成本 | 每 agent / 每 thread / 每天 token 和金额 |

### 7.2 控制什么

- 创建 / 配置 / 禁用 / 恢复 / 删除 agent
- 暂停 / 杀死 / 重启 agent 或单个 session
- 设置预算、allowlist、trust、房间策略
- 批准/拒绝 merge、deploy、delete、付款
- 全局 kill switch

### 7.3 “一切”的边界

建议定义三个审计级别：

| 级别 | 记录 | 用途 |
|---|---|---|
| `metadata` | 谁、何时、哪个房间、多少 token/成本 | 最低成本 |
| `messages` | 消息正文 + 工具调用摘要 + 成本 | v0 默认 |
| `full` | 完整 prompt / 工具参数 / 结果 | 排障/合规，存储和隐私成本高 |

v0 建议 `messages`；不记录模型内部 chain-of-thought。以后可按房间/agent 配置 `full`。

### 7.4 形态

- v0：一个简单的 Web dashboard（列表 + 实时流 + 审批 + 暂停/杀死 + 成本），可以后做，但数据模型和事件流要先留好。
- Element 仍然作为人类聊天客户端；数据平台是“控制台/观测台”，不是聊天 UI 的替代。
- 未来商业化时，这就是 admin/compliance console，按 workspace 隔离。

【你的批注】：
v0做成网页还是app？数据台应该跟软件形式做在一起吧

---

## 8. Matrix 和 Element 是什么？和微信有什么不同？

- **Matrix**：一个开放的聊天协议 + 服务器。你可以自己跑一个 homeserver，账号形如 `@kudo:agents.local`；房间、DM、群聊、历史、presence、权限、E2E、桥接都是协议的一部分。
- **Element**：Matrix 的客户端 App（网页/桌面/手机），界面像微信/Slack，但开源、可自托管。
- **Synapse**：Matrix 的官方服务器实现（Python，成熟但重）；Conduit/Dendrite 是更轻的替代。

和微信的区别：

| | 微信 | Matrix |
|---|---|---|
| 谁控制服务器 | 腾讯 | 你自己 |
| 账号 | 平台分配 | 你自己创建（包括 agent） |
| 管理员 | 群主，能力有限 | server admin + room power level，可做全局审计 |
| 机器人 | 二等公民，平台限制 | 可以作为普通用户/虚拟用户接入 |
| 开放协议 | 否 | 是，可桥接、可联邦 |
| 私密 vs 审计 | 平台说了算 | 你自己定策略（透明/E2E） |

所以“微信功能上有点像”是对的，但微信是**人和人**的封闭平台，没有你要的超级管理员和 agent 一等公民；Matrix 更像“可自建的、开放的 IM 基础设施”。

为什么 v0 选 Matrix：

- 身份、房间、DM、群、presence、历史、已读、附件、管理员、客户端都现成；
- 你只需要造 agent 特有的网关、协议、策略、审计、数据平台；
- 未来可以通过 `ImTransport` 适配器换/加飞书、Slack、自建，不用重写核心。

【你的批注】：
这个还能直接扩展接入 微信 飞书？

---

## 9. 这一轮会怎么改 00 合同

我会把以下内容写进 [00 需求合同](../00-requirements-contract.md)：

1. 范围改为 **local-first + 公开/商业扩展缝**（不做多租户/计费，但留 `workspace_id`、role/scope、ImTransport、adapter、审计、配置）。
2. 增加 **角色与 scope**：platform_admin / workspace_admin / member / agent / auditor / service。
3. 增加 **房间隐私矩阵**：agent-agent / human-agent 默认透明；human-human 私密；外部按策略。
4. 增加 **agent 生命周期**：created → active → idle → paused → disabled → deleted；软删保留历史。
5. 增加 **Agent Runtime Adapter 契约**：5 个方法 + capabilities；ACP/HTTP/SDK 都只是 adapter。
6. 把 **自主群聊 / 会议协议** 放进 Must：intent、发言规则、决议、task、回合上限。
7. 把 **数据平台最小 dashboard** 放进 Must（可以先做只读 + 控制按钮）。
8. 更新 MoSCoW 和 MVP 验收：群聊讨论 + 决议 + 分工 + 执行 + 审计。
9. 更新假设：本机无 Docker/WSL2、无 Codex/dsh；底座待确认。

【你的批注】：
文档随做随改，跟我们的会话记录是两码事，隔离开

---

## 10. 还需要你确认的 8 个问题

请直接在每行下面批注（同意 / 改成什么 / 为什么）：

**A. 目标与商业**
v0 只给你自己本地用；未来公开/商业只留缝、不做功能。同意吗？
可以 先做mvp，验证是否可行

**B. 平权定义**
身份/消息模型对等 + 治理权限不对称 + agent 房间受治理透明；human-human 私聊以后再做。同意吗？
可以，现在也没别人，不过这个应该也不麻烦，扩展也方便吧

**C. Agent 生命周期**
agent 由你创建/配置/删除；“永久”= 不删就稳定；软删保留历史。同意吗？可

**D. Runtime 协议**
我们定义薄 adapter 契约；ACP 只是 adapter 之一；v0 先接 Claude + 一个脚本 peer，再加 Codex/OpenClaw/dsh/Hermes。同意吗？可 先用claudecode 跑通，再加其他agent

**E. 群聊决议**
v0 由人类最终拍板；agent 可以提议/投票/推荐，但不自动产生共识。同意吗？还是你想要某种自动共识（例如全员 agree / 多数票）？如果群聊讨论顺利，应该能有共识吧，产生分歧的时候 应该有个agent来 @ 相关方面角色的 人类 让人类提供信息，我觉得 agent总会达成共识的吧，如果最终总有分歧，也是 @ 相关人 来决定。你说的自动产生共识 是怎么个形式？

**F. 数据平台**
v0 做最小 dashboard（agent/房间/实时事件/审批/成本/暂停杀死），不是完整商业控制台。同意吗？还是第一版就要更完整？
可以简单点，后面再扩展详细

**G. IM 底座**
v0 用 Matrix + Element；通过 `ImTransport` 适配器为未来换底座留缝。同意吗？还是你想先看飞书/微信的可行性？
先简单点

**H. 约束**
你每周大概能投入多少小时？每月 API 预算上限多少？是否接受装 Docker Desktop + WSL2（数据放 D 盘）？还是更倾向用办公机/小 VPS 跑 Matrix？
我只要给出意见吧，需要我做什么吗？
api 我要是不够了 会给你停了的，不用担心
本机能跑吗？

【你的批注】：
