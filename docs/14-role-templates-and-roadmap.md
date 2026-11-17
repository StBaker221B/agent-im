# 14 角色模板与开发计划

- 状态：2026-11-17 **已实现 13 个内置角色模板 + 角色知识包 + 创建/设置 UI + 工具权限三档 + 规则 triage/用量/每日 USD 预算 + 3 个团队模板 + token 流 + 合作式工具审批 + agent 时间戳记忆**；自定义角色/团队模板、O*NET/ESCO 导入、执行前审批/强沙箱待做。
- 关联：[13 MVP 架构](13-mvp-architecture.md) · [09 协议](09-agent-protocol.md) · [记录 10 自主修测试](records/2026-11-16-10-autonomy-bugfix.md) · [记录 11 角色模板决策](records/2026-11-16-11-role-template-decisions.md)
- 过程批注已移入记录 11；本文只保留项目状态和决策。

## 1. 「讨论模式」toggle 的结论

之前那个 toggle 实际只做两件事：

- 把 agent 链上限从 3 提到 6；
- 在 prompt 末尾加一句“如果另一个 agent 的观点需要具体追问/反驳，@ 对方继续”。

它**不改变唤醒策略、不强制轮次**。两个 agent 时，3 和 6 的差别几乎看不到，所以“讨论模式 / 讨论中”感觉没区别。

已做：

- 去掉群聊头部的 toggle。
- 链上限改成全局 **10**，只作为防死循环的护栏，不是对话轮数限制。
- “需要追问/反驳就 @ 对方”的提示改为默认提示，不再按模式开关。
- `room.mode` 字段保留兼容，但不再影响行为；后续可以删。

## 2. 为什么要角色模板

你现在看到的 4 个角色模板（generic/coder/reviewer/researcher）只是最小分类。真正要复用角色，需要一张**角色卡**，而不只是一行“你是 coder”。

### 2.1 角色卡 schema（建议）

```jsonc
{
  "id": "reviewer",
  "name": "代码评审",
  "mission": "在提案进入实现前找出具体风险，避免返工。",
  "responsibilities": [
    "检查失败场景、边界、反例、安全/并发/兼容问题",
    "给出可操作的修正建议",
    "确认修复后收尾"
  ],
  "boundaries": [
    "不替提案人写完整实现",
    "不修改文件（只读）",
    "没有具体风险时 PASS，不硬找问题"
  ],
  "decisionRights": ["可以否决提案直到风险被解释或修复"],
  "thinkingStyle": "对抗式、证据优先、先找反例",
  "communicationStyle": "短、具体、引用文件/行为；不客套",
  "knowledgePacks": ["code-review-checklist", "project-constraints"],
  "tools": { "allow": ["Read", "Glob", "Grep", "PowerShell"], "workspace": "read-only" },
  "handoff": { "ask": "提案人", "done": "测试通过且无未解释风险" },
  "successCriteria": ["发现的问题可复现", "建议可执行", "不重复"],
  "defaults": { "wakePolicy": "human_all", "speakMode": "volunteer" }
}
```

**角色需要自己的知识库**：每个模板带一份 `app/role-knowledge/<id>.md`，写清工作方法、检查清单、权责边界、**使用者预期**、常见失败；运行时会拼进 system prompt。agent 自己的 notes 仍然在 `agentHome/knowledge/`。

### 2.2 知识分层，不要每个 agent 都手配

建议四层，创建 agent 时只选/覆盖差异：

1. **Workspace / 团队共享**：项目背景、架构、约束、术语表（所有 agent 都读）。
2. **Room / 项目共享**：当前任务、房间历史、项目文档。
3. **Role pack**：角色自带的知识包（reviewer 的 checklist、researcher 的资料来源规范）。
4. **Agent private**：这个 agent 自己的 notes、session、workspace。

检索/拼装顺序：workspace → room → role pack → agent private。模板只负责 3，创建时挂 1/2，agent 自己积累 4。

### 2.3 创建体验

- 新建 agent：**选模板 → 预览角色卡 → 改 mission/职责/边界/思维风格 → 选知识包/工具 → 创建**。
- 模板可以“另存为”自定义模板；支持 clone + 微调。
- 团队模板：一次创建一组角色（软件小队：PM + BA + architect + coder + reviewer + QA；方案评审小队；调研小队）。
- 角色卡在资料页可见，便于人类和 agent 都知道彼此职责。

## 3. 现成来源与选项（2026-11-16 查过）

| 来源 | 规模/状态 | 能拿来做什么 | 适合程度 |
|---|---|---|---|
| [MetaGPT](https://github.com/geekan/MetaGPT) | ★71k | 软件公司 SOP：PM / Architect / ProjectManager / Engineer / QA 的职责与交接 | **高**：软件团队角色和 handoff 直接可借鉴 |
| [ChatDev](https://github.com/OpenBMB/ChatDev) | ★34k | CEO / CTO / Programmer / Reviewer / Tester 的软件公司角色 | **高**：review/test 闭环 |
| [CrewAI examples](https://github.com/crewAIInc/crewAI-examples) | ★6k | `role / goal / backstory / tools` 的干净 schema | **高**：字段设计可直接借 |
| [LangGPT](https://github.com/langgptai/LangGPT) | ★12.7k | 结构化提示词模板（Role/Profile/Goals/Constraints/Workflow） | 中高：写角色卡的结构 |
| [prompts.chat（原 awesome-chatgpt-prompts）](https://github.com/f/prompts.chat) | ★177k | 大量 “Act as …” 职业提示词 | 中：覆盖面广，但浅、偏扮演，需改写 |
| [CAMEL](https://github.com/camel-ai/camel) | ★18k | 角色扮演/双 agent 对话数据与模板 | 中：角色配对、对话风格 |
| [AutoGen](https://github.com/microsoft/autogen) | ★61k | agent 描述、system message、对话模式 | 中：多 agent 协作模式 |
| [AgentVerse](https://github.com/OpenBMB/AgentVerse) | ★5k | 任务求解型多 agent 框架 | 中低：角色库不是重点 |
| [O*NET](https://www.onetcenter.org/database.html) | 美国劳工部职业数据库 | 每个职业的 tasks / skills / abilities / work activities / KSA | **高（结构化）**：生成职责/技能字段 |
| [ESCO](https://esco.ec.europa.eu/en/use-esco/download) | 欧盟职业/技能分类 | 职业、技能、知识、能力 | **高（结构化）**：多语言职业数据 |

**已选来源组合**：以 MetaGPT/ChatDev 的软件团队职责为主，CrewAI 的 `role/goal/backstory` 作为字段结构，LangGPT 的结构化写法；O*NET/ESCO 作为后续扩充结构化任务/技能的底稿；prompts.chat 只做灵感，不原样导入。冲突处理原则：职责以软件团队实践为主，安全/边界以 reviewer/security 的检查清单为主，公司经营角色只保留可执行指标/流程，不写空泛愿景。

### 3.1 推荐组合

- **角色结构**：MetaGPT/ChatDev 的软件团队角色 + CrewAI 的 `role/goal/backstory` 字段。
- **职责/技能内容**：O*NET/ESCO 的 tasks/skills 作为底稿，人工压缩成 3–6 条可执行职责。
- **提示词写法**：LangGPT 的结构化模板；prompts.chat 只作为灵感，不直接导入。
- **不建议**：把几千个职业描述原样塞进 prompt（太长、偏人类岗位、缺少工具/handoff/PASS 条件）。

**角色范围决策**：先做 **13 个内置模板**（含 generic），覆盖软件、产品/需求/测试、公司经营；对业务权责/边界/沟通的要求写进角色卡和知识包。以后向上下游扩（marketing、sales、finance、support 等）。

## 4. 角色模板库（已实现）

1. `app/role-templates.mjs`：13 个角色卡：
   - 通用：generic
   - 软件：architect、coder、reviewer、qa、ops、security
   - 产品/需求：facilitator、product-manager、business-analyst、researcher、tech-writer
   - 公司经营：operations
2. 每张卡带：mission / responsibilities / boundaries / decisionRights / thinkingStyle / communicationStyle / knowledgePacks / tools / handoff / successCriteria / defaultWakePolicy。
3. `app/role-knowledge/<id>.md`：13 份角色知识包（工作方法、检查清单、权责、使用者预期、常见失败）。
4. `GET /api/role-templates`；`POST /api/agents` / `PATCH /api/agents/:id` 接受 `templateId`、`toolsEnabled`。
5. 新建 agent：模板选择 + 角色卡预览 + 个人补充 + 工具开关；每个 agent 的设置页支持换模板。
6. 资料页/Agents 页显示模板名和 mission。
7. 现有 agent 迁移 `templateId`；`composeSystemPrompt` = base + 角色卡 + 角色知识包 + agent 私有 knowledge。

团队模板（已实现）：

- `app/team-templates.mjs`：
  - `software-squad`：product-manager + business-analyst + architect + coder + reviewer + qa（PM 负责需求/优先级，BA 负责业务流程/规则/边界）。
  - `review-squad`：architect + reviewer + security；评审方案可行性、风险和安全；不承担调研。
  - `research-squad`：researcher + tech-writer；一个查证、一个把结论写成材料。
- `GET /api/team-templates`；`POST /api/team-templates/:id/create {prefix,groupName}`：注册 N 个用户、创建 N 个 agent、建群并拉入；ID 形如 `squad-pm`。
- Agents 页「创建小队」→ 选模板、ID 前缀、群名 → 创建后打开群。实测 `demo` 旧版 review-squad 创建成功。
- **有效性验证**：coder→reviewer 的角色协作和自主修测试实验验证过；2026-11-17 又跑了单 coder vs coder+reviewer 的 pilot：
  - 同一小 bug，单 coder 1 turn/$0.2237/~16s，coder+reviewer 2 turns/$0.6690/~75s；都 5/5，test 未改。团队成本约 3×、耗时约 4.7×，这个任务上没有质量优势，reviewer 提供的是独立复验。
  - 6 人软件小队仍未做完整对照；结论是“简单任务单人更划算，团队用于需要独立评审/风险取舍的任务”。详见[记录 16](records/2026-11-17-16-team-pilot.md)。
- **可重复 benchmark（已落地）**：`bench/tasks/money-rounding` + `bench/run.mjs`，固定 fixture、新建 agent/session、独立 workspace、自动看测试/成本/turns、跑完软删。
  - 两次 fresh run：single 均值约 $0.115/35.5s；pair 均值约 $0.788/155s（成本 6.8×、耗时 4.4×），都 5/5、测试未改。
  - 一次 squad：5/5，但 362s 超时、5 turns、$2.547（单人约 22×）；简单任务上 6 人队明显过度配置，讨论收敛也太慢。
  - 波动大（pair $0.65–$0.93），单次不能下结论；“单 Claude+subagent”基线还没跑。详见[记录 18](records/2026-11-17-18-repeatable-benchmark.md)。

待做：自定义角色/团队模板另存、O*NET/ESCO 自动生成、删除/归档实验 agent。

## 5. 剩余工作与开发计划

### 5.1 完成度概览

| 模块 | 状态 | 还差什么 | 粗略工作量 |
|---|---|---|---|
| 协议/引擎/Matrix | ✅ 可用 | 并行化、更多测试 | 1–2d |
| 产品 UI（会话/群/私聊/媒体/搜索/设置/资料） | ✅ 可用 | 细节、键盘/移动端打磨 | 1–2d |
| 角色模板库 + 创建向导 | ✅ 已实现 13 个 + UI | 自定义/团队模板、O*NET 导入 | 1–2d |
| 成本控制 | ⚠️ v2 已做 | 规则 triage + 参数 UI、用量视图、每日 USD 预算；全局预算、per-thread 预算待做 | 1d |
| 工具审批/沙箱/流式 | ⚠️ v1 已做 | text_delta/SSE、REQUEST_TOOL + 单工具持久 grant、off `--tools ""` 硬拒绝；执行前审批、按 thread/过期授权、worktree/容器沙箱待做 | 2–4d |
| Agent/房间生命周期 | ⚠️ 部分 | 暂停、软删除、改显示名已完成；硬删除/undelete、移除成员、邀请第二个人类、批量操作待做 | 1–2d |
| 团队 benchmark | ⚠️ v1 已做 | fixture + runner、single/pair 各两次；更多任务/squad/单 Claude+subagent/质量指标待做 | 2–3d |
| 多用户/鉴权 | ⏳ 未做 | 登录、权限、房间 ACL、人类邀请 | 3–5d |
| 数据平台最小版 | ⏳ 未做 | 审计/用量/会话检索/治理视图 | 2–4d |
| 第二 runtime / worktree | ⏳ 未做 | OpenClaw/Codex adapter、worktree 隔离 | 3–5d |
| 搜索分页/索引 | ⚠️ 部分 | 现在每房间最近 100 条；分页/索引 | 1–2d |
| 运维/部署 | ⚠️ 部分 | Tuwunel 自启、打包、备份、一键启动 | 1–2d |
| App/Web 自动化测试 + CI | ⏳ 未做 | API/store/UI 测试、CI | 2–3d |
| Kill criterion 实验 | ⏳ 未做 | 单 Claude + subagent 对比 | 2–3d |

> 粗算：做到“自己每天愿意用”的本地 MVP 还要 **3–5 周**（全职节奏）；多用户/公网另算。

### 5.2 建议顺序

**第 1 周：角色与成本**

1. ✅ 角色模板库 + 创建向导（13 个模板、知识包、API/UI）。
2. 成本控制：**v2 已做**规则 triage + 参数 UI（cooldown/maxTurns/skipAcks）+ `triage_skip` 审计 + `GET /api/usage`/设置页用量 + 每 agent `dailyBudgetUsd`（超预算 PASS/`budget_skip`）。待做全局预算、per-thread 预算。**triage** = 跑完整模型 turn 前，用规则或便宜小模型判断这条消息需不需要该 agent 回/该谁处理，减少 `human_all` 下 N 个完整 turn。
3. 把“讨论轮次/链上限”变成可配置的护栏，不做强制。

**第 2 周：工具与治理**

4. 工具审批 v1 + 沙箱：合作式 REQUEST_TOOL/单工具批准已做；执行前审批、按 thread/过期授权、coder worktree/reviewer 只读沙箱待做。
5. 流式输出：token delta + SSE + UI 实时气泡已做；tool_use 参数/思考流待做。
6. Agent/房间生命周期：暂停（`paused_skip`）和软删除已完成；硬删除/undelete、移除成员、邀请人类、批量操作待做。
7. 数据平台最小版：审计/用量/会话检索。

**第 3 周：异构与多用户**

8. 第二个 runtime（OpenClaw/Codex）+ worktree。
9. 多人类/鉴权/邀请；房间 ACL。
10. 搜索分页/索引、运维打包。

**第 4 周：验证与收敛**

11. App/Web 测试 + CI。
12. “单 Claude + subagent” kill criterion 对比。**kill criterion** = 同一任务对比多 agent IM 与单 Claude + subagent；如果完成质量、token 成本、人类干预次数没有明显优势，就停止扩张，转为观测/治理层或个人工具。
13. 根据结果决定：继续做产品，还是收敛成观测/治理层。

### 5.3 风险

- **成本**：角色越多、工具越活，turn 越贵；修测试实验 5 turn $2.16。没有 triage/预算前不适合放开多 agent。
- **权限**：`dontAsk + allowedTools` 不是沙箱；off 用 `--tools ""` 硬拒绝，reviewer 的只读仍靠 prompt。真正的工具隔离要 worktree/容器/执行前审批。工具审批 v1 是 turn 后的合作式申请，批准是单工具持久 grant。
- **角色泛滥**：模板太多会像“扮演”；先把 8 个软件团队角色打磨好，再扩。
- **多用户**：Matrix 账号/权限模型要重做，不能靠单一 human token。

## 6. 已拍板 / 待拍板

已定：

1. **角色范围**：先从软件团队出发，覆盖需求/测试/产品/公司经营；先做 13 个，以后向上下游扩展。
2. **知识包**：先手工写 13 份精简角色卡 + 知识包，参考 MetaGPT/ChatDev/CrewAI/LangGPT；不足自己补；O*NET/ESCO 自动化后续再做。
3. **权限观**：角色定义职责，权限是安全护栏；`toolsMode=template|full|off`，需要写权限时手动放开 full（reviewer/security 也可以），默认只读靠角色 prompt；暂不做强沙箱。权限相对开放，但不影响安全边界。
4. **顺序**：角色模板先做（已完成），成本控制紧随其后；两者都做。
5. **节奏**：先做到自己每天愿意用，再跑 kill criterion 对比；不是先证明再可用。

待定：

- 自定义模板/团队模板的编辑体验（另存、clone、一次建一组）。
- 是否接 O*NET/ESCO 自动生成角色卡；生成后如何人工审。
- triage 用规则还是小模型；预算/冷却默认值。
- 真正沙箱/审批的边界（worktree/容器/工具白名单）。
- 角色模板是否要版本化和团队共享。
- **团队有效性**：已有可重复 runner，但只跑了 single/pair 的 money-rounding 任务；6 人 squad 和“单 Claude+subagent”基线还没跑，质量指标也只有测试通过/未改。
- **agent 自主建群/私聊**：现在房间只能人类创建，agent 只能在已有房间 @ 其他成员；是否允许 agent 发起 DM/群、需不需要人类批准，未定。
- **agent 设置页拆分**：已从全局设置移到 Agents 页每个 agent 的「设置」；后续可做模板另存和批量操作。