# 2026-11-15 第三轮答复（对应你的新批注）

> 过程记录，不是正式文档。你的批注在 [第二轮答复](2026-11-15-03-answers-round2.md)。
> 已 push 到 Gitee：commit `5b27745`（`master`），办公机可以直接 `git pull`。
> 稳定结论会合并进 [00 合同](../00-requirements-contract.md) 和 [09 协议](../09-agent-protocol.md)。

## 1. Runtime 常驻 vs 懒启动：状态会断吗？启停贵吗？

**结论：状态不会因为进程休眠而丢，但“正在跑的那一轮”会丢；所以只在空闲时睡，不在 turn 中间杀。**

- **逻辑状态**在 agent home + Matrix 历史 + session 表里；进程只是“算力”。
- **进程启动** 1–2 秒（你看到的 VS Code Claude Code 启动延迟是正常的）；**session resume** 可能更贵（加载上下文/摘要，可能几千到几万 token）。
- **频繁按消息启停** 很浪费；**按活跃 thread 保温** 才合理。

建议的混合策略：

| 场景 | 行为 |
|---|---|
| 有正在跑的 turn / 多步工具调用 | 保持 runtime 活着，不杀 |
| 活跃 thread（最近 10–30 分钟有消息） | 保持 warm runtime |
| 冷 thread（超过 TTL） | 停进程；session 引用保留；下次消息冷启动 + resume |
| 冷启动失败 | 从最近 N 条 Matrix 消息 + memory 摘要重建；提示“waking up” |
| 笔记本内存紧 | 只 warm 1–2 个 runtime；其他懒启动 |

**连续性**：同一个人格/配置/记忆/工作区，session resume 恢复对话上下文；不同 thread 的上下文本来就是隔离的（像同一个人参加不同会议）。如果要求“跨 thread 完全同步”，就要共享 memory + 每轮同步，代价是延迟和复杂度；v0 不做强一致。

## 2. 一个 agent 用户 vs 多个 runtime：应该绑到哪里？

你的直觉是对的：**不要把 agent 用户绑死在一个 runtime 进程上，应该绑到一个 agent home（专属文件夹/状态包）**。

```
agents/<agent-id>/
  config.yaml        # 人格/prompt、runtime、模型、工具、预算、trust、roles、can_invite
  memory/            # agent 级记忆：事实、技能、决策（append-only + 快照）
  sessions/          # thread -> native_session_id / summary / last_event_id
  workspace/         # 非编码 scratch；编码用 worktrees/<thread>
  audit/             # 本地事件日志（或写全局审计）
```

- **身份 = agent home**；runtime = 可替换的 worker。
- 一个 agent 可以有 **N 个 runtime worker**，每个处理一个/多个 thread；它们共享同一个 home。
- **一致性怎么保证**：
  - **人格/配置**：版本化，所有 worker 每轮开始时读同一版本。
  - **记忆**：gateway 作为单写者，worker 每轮结束提交 memory delta；gateway 做版本检查/合并；worker 下轮开始拉最新。v0 用 SQLite + gateway 拥有状态即可，近实时，最终一致。
  - **工作区**：编码 agent 每个 thread 一个 git worktree，禁止两个 worker 同时改同一目录；非编码用 agent scratch + 文件锁。
  - **session**：按 thread 隔离，这是有意的；跨 thread 的一致性靠共享 memory，不靠共享对话上下文。
  - **预算/策略**：集中在 gateway/DB，所有 worker 遵守。
- **要不要一个会话一个 runtime？**
  - v0：**一个 agent 一个 worker**，内部按 thread 管 session（runtime 支持多 session 时）；不支持就“每个活跃 thread 一个 worker，上限 N（如 3），空闲 TTL 回收”。
  - 一个 worker 忙不过来时，再加 worker；不是每条消息起一个。
  - 如果要求严格跨 thread 一致：只能单 worker 串行，或每轮做 memory 同步；v0 不要求。
- **信息同步及时吗？** gateway 单写 + worker 每轮提交 delta，近实时；关键事实用版本号/锁。不要多个 worker 直接写同一个文件。

一句话：**身份绑 agent home，runtime 是可水平扩展的 worker；一致性靠共享配置/记忆 + 每 thread 单写，不靠绑死进程。**

## 3. 一个 agent 一个 gateway，还是共用一个 gateway？

v0：**一个 gateway 进程，内部多个 agent worker**。

- 每个 worker 有自己的 Matrix 账号/token、session、预算；gateway 负责 sync/队列/floor/审计。
- 好处：省内存、少进程、调试简单。
- 代价：gateway 崩溃会带走所有 worker；本地单用户可接受，supervisor 重启即可。
- 以后要隔离/多租户/安全，再拆成 **per-agent gateway/container**。
- **gateway 不是身份**；身份是 Matrix 账号 + agent home。

## 4. 群聊：所有 agent 都应该收到所有消息

对，这点我之前说得不够清楚。区分两件事：

- **投递（delivery）**：房间成员都会收到所有消息；`@` 不是“只发给被 @ 的人”，只是**注意力/优先级信号**。每个 agent 的 gateway 都会 sync 到这条消息，消息在房间历史里。
- **唤醒（wake）**：不是每条消息都要叫醒每个 agent 跑一轮模型（烧钱）。Gateway 有 `wake_policy`：
  - `all`：每条都唤醒；
  - `mention_or_reply`（推荐）：被 @/被回复才唤醒；
  - `mention_only`：只被 @ 才唤醒；
  - `digest`：定时汇总唤醒。
- 没被唤醒的 agent，下次醒来时仍能看到完整房间历史（它 sync 过）。

Envelope 里给 agent 明确字段：

```json
{
  "room_id": "...",
  "thread_id": "...",
  "sender": "@kudo:...",
  "mentions": ["@claude-dev:..."],
  "direct_mention": true,
  "reply_to": "$event...",
  "attention": "direct_mention | reply | room_mention | ambient",
  "intent": "proposal",
  "text": "...",
  "recent_messages": [...]
}
```

所以：**所有人收到，所有人可读；但不是所有人都被叫醒。** 被 @ 的 agent 获得 floor 优先级，但不独占消息。

## 5. interrupt 是什么？“全都闭嘴听我说”？

接近，但更准确：

- `!interrupt` = **抢占当前 floor**：让正在跑的 turn 停到安全点/中断，人类拿到发言权；不是永久禁言。人类说完后，agents 可以继续回应。
- `!pause` / `!kill` / `!approve` 是**控制命令**，必须执行；内容上的“人类说得对不对”agent 可以反驳。
- 普通人类消息不是 interrupt，只是高优先级输入；同一 thread 默认 steer，不同 thread 进 inbox。

### 两套轮转：IM 侧 vs runtime 侧

你说的“各是各的轮转，中间 gateway 做桥梁”是对的：

```
IM 侧（Matrix）：
  sync → 房间/线程事件队列 → 按房间保序
        │
   Gateway（桥 + floor + session 映射 + 审计）
        │
Runtime 侧：
  session turn 队列 → 一个 session 同时只跑一个 turn → adapter 流式输出
```

- IM 侧按 **room/thread** 保序；runtime 侧按 **session** 串行。
- Gateway 把两边映射起来：thread ↔ session；floor 保证同一 thread 只有一个 writer。
- Runtime 不知道 Matrix；Matrix 不知道 native session。
- 不同 thread/session 可以并行；同一 thread 串行。

## 6. idle / waiting 的区别；静默检查要不要轮询？

| 状态 | 含义 | 消耗算力 |
|---|---|---|
| `idle` | 没有当前任务，可用/在听 | 否 |
| `waiting` | 有任务，但卡在外部输入（工具结果/审批/floor/人类回答/网络） | 否 |
| `thinking` | 模型正在生成 | 是 |
| `working` | 工具/命令正在跑 | 是（工具侧） |
| `done` | 当前任务完成，仍在房间 | 否 |
| `pass` | 这一轮选择不发言 | 否 |
| `error` | 失败，需要处理 | 否（但需要告警） |

**静默检查**：不需要轮询每个 agent。gateway 在状态变化/最后一条实质消息时设置一个 `quiet_window` 定时器；到点做一次条件检查即可。再加一个低频心跳（如 5 秒）兜底即可。事件驱动优先，轮询只是兜底。

## 7. 群聊没有 owner 怎么办？身份/分工/拉人

需要补一套**角色与升级链**，不是只靠“agent 自己猜”：

### Agent Card 增加

```json
{
  "roles": ["pm", "reviewer", "coder"],
  "domains": ["auth", "frontend", "rust"],
  "owner": "@kudo:...",
  "reports_to": "@kudo:...",
  "can_invite": "allowlist | none | room | approval",
  "trust": "internal"
}
```

### 房间/议程角色

- `host` / `facilitator`：会议发起人或被指定的人；
- `task owner` / `assignee`：具体任务的负责人；
- `expert`：按领域找的人；
- `observer` / `approver`：旁观/审批。

角色可以随 **agenda/task** 动态指定，不只按全局身份。

### 升级链（确定性）

```
task owner → room facilitator/host → agent owner → admin
```

没有 owner 就找 facilitator；没有 facilitator 就到 agent owner；再不行到 admin。`@` 的目标由这条链解析，不是随便 @ 一个人类。

### 怎么知道找谁

- v0：agent card 的 `roles/domains` + 房间成员表；gateway 提供 `who_can_help(topic)` 查询。
- 以后：Directory 能力搜索（按 capability/tool/model/owner）。

### 拉人权限

- `can_invite` 在 agent 创建/配置时设定，gateway 强制执行：
  - `none`：不能拉人；
  - `allowlist`：只能拉 allowlist 里的 agent；
  - `room`：可以拉房间成员；
  - `approval`：需要 Admin 批准。
- “什么时候该拉谁”可以写进 agent 的 skill/instruction，但**权限**由 gateway 管，不靠 agent 自觉。
- v0 简化：roles 静态、can_invite=allowlist；动态议程角色和 directory 搜索后加。

## 8. 除了 Matrix 还有什么选项？

| 底座 | 优点 | 缺点 | 适合 |
|---|---|---|---|
| **Matrix + Element** | 开放协议、自建、agent 可当普通用户、房间/历史/presence/权限/桥接/多客户端 | 协议大、Synapse 重、E2E 与审计冲突 | **v0 推荐** |
| Mattermost | 自托管 Slack 替代、bot/插件成熟、Go 单二进制+Postgres、客户端好 | bot 是二等公民；无联邦；thread/mention 语义不如 Matrix 灵活 | Matrix 运维太重时的备选 |
| Rocket.Chat | 自托管、omnichannel、bot | Node/Mongo，重；bot 二等公民；定制复杂 | 已有 RC 生态时 |
| Zulip | 主题/线程模型极好、自托管 | UI 偏邮件/话题；bot 能力一般；生态小 | 强 thread 场景 |
| XMPP（Prosody/ejabberd） | 开放、轻、成熟、JID 天然身份 | 客户端/多端/线程 UX 弱；要自己补很多 | 极简/嵌入式 |
| 飞书/Slack | 人类入口好、移动端现成 | 平台限制、bot 二等公民、无全局 admin、ToS | 人类入口桥，不做底座 |
| 自建 | 完全控制 | 6–12 个月重造身份/房间/presence/客户端 | 产品化后期 |
| P2P（x0x） | 真对等、无中心 | 没有你要的全局 Admin | 跨组织阶段 |

**推荐**：v0 用 Matrix + Element；保留 `ImTransport`。如果 Matrix 运维/性能成为瓶颈，Mattermost 是最现实的备选；Zulip 适合 thread-first；XMPP 适合极简。**不要现在换**，先把 agent 协议跑通。

## 9. 需求 skill：有没有更推荐的？

| Skill | 安装量 | 说明 |
|---|---|---|
| `addyosmani/agent-skills@spec-driven-development` | **78.2K** | 最流行；spec-first 工作流；和你已装的 `interview-me` 同源，可信 |
| `jwynia/agent-skills@requirements-analysis` | 2.3K | 专门做需求诊断（RA0–RA5），更聚焦 |
| `github/awesome-copilot@prd` | 24.6K | PRD 模板，偏文档 |
| `bmad-code-org/bmad-method@bmad-agent-po` | 6.1K | 完整 BMAD 产品负责人代理，重 |

**建议**：装 `addyosmani/agent-skills@spec-driven-development`（最流行、和 interview-me 同源）；`jwynia` 作为需求诊断补充，可选。

但 `npx skills add` 失败了：本机 GitHub clone 被 reset（`SKILLS_GIT_CLONE_FAILED`）。已用绕法手动装好：`codeload.github.com` 下 tar.gz → Python `tarfile` 解包 → 写入 `C:\Users\kudo\.claude\skills\spec-driven-development\SKILL.md`。`jwynia` 作为需求诊断补充，暂不装。

## 10. 本机 vs 办公机：会有区别吗？

会有，但主要是环境差异，不是代码逻辑差异：

| 差异 | 影响 | 处理 |
|---|---|---|
| Win11 Home vs Pro | Docker/WSL/虚拟化能力不同 | 用 Docker Compose；Pro 上可跑 WSL2 后端 |
| 路径/用户名 | 工作区、数据目录 | 配置走 `.env`/`config.local`，不写死 |
| Node 版本 | 构建/运行 | `engines` + `.nvmrc`/Volta；本机 Node 24 |
| Claude/Codex 登录 | 每台机器各自登录 | 不进 git；文档写清 |
| 网络/防火墙/端口 | Matrix/网关访问 | 文档记录端口；跨机用 LAN/VPN |
| Matrix 数据 | 不在 git | Docker volume + 备份；办公机可连同一 homeserver 或单独跑 |
| Git 换行/大小写 | Windows CRLF/大小写不敏感 | `.gitattributes` + 统一小写路径 |
| 模型/API 预算 | 各自环境变量 | 不进 git |

**办公机复现步骤**（后面写进 `docs/10-dev-setup.md`）：`git pull` → 装 Node/Docker → 复制 `.env.example` 为 `.env` → `npm install` → `docker compose up` → 登录 Claude/Codex → 跑 spike 测试 → 再起 Matrix。

**本机先搞**：同意；第一个 spike 不需要 Docker，先把协议/调度器跑通；Docker/WSL2 的安装在需要上 Matrix 时再做（需要你点 UAC/重启）。

## 11. 下一步

1. 把本轮结论合并进 00；写正式 `09-agent-protocol.md`。
2. 本地 spike：假总线 + 调度器 + 脚本 agent + 测试（不需要 Docker）。
3. 用 codeload 手动装 `spec-driven-development`（可选，失败就先用现有工具）。
4. 本机 Docker/WSL2 安装指南 + 办公机复现清单（`docs/10-dev-setup.md`）。
