# 14 角色模板与开发计划

- 状态：2026-11-16 提案 + 已完成的 toggle 简化；角色模板库尚未实现。
- 关联：[13 MVP 架构](13-mvp-architecture.md) · [09 协议](09-agent-protocol.md) · [记录 10 自主修测试](records/2026-11-16-10-autonomy-bugfix.md)
- 用法：这份文档可以直接在段落旁写批注（`> 批注：…`），定稿后再拆进 13/09。

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

> 批注：

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
- 团队模板：一次创建一组角色（如“软件小队”：PM + architect + coder + reviewer + QA）。
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

### 3.1 推荐组合

- **角色结构**：MetaGPT/ChatDev 的软件团队角色 + CrewAI 的 `role/goal/backstory` 字段。
- **职责/技能内容**：O*NET/ESCO 的 tasks/skills 作为底稿，人工压缩成 3–6 条可执行职责。
- **提示词写法**：LangGPT 的结构化模板；prompts.chat 只作为灵感，不直接导入。
- **不建议**：把几千个职业描述原样塞进 prompt（太长、偏人类岗位、缺少工具/handoff/PASS 条件）。

> 批注：

## 4. 角色模板库的实现计划（建议 1–2 天）

1. 新增 `app/role-templates/*.json`（先 8 个）：
   - facilitator（主持人/收敛）
   - product-manager（需求/优先级）
   - architect（方案/边界）
   - coder（实现/测试）
   - reviewer（对抗式评审）
   - qa（测试/复现）
   - researcher（查证/对比）
   - writer（文档/总结）
   - ops/security 可选第 9/10 个。
2. 每个模板带：角色卡字段、默认知识包、默认工具白名单、默认 wakePolicy。
3. `GET /api/role-templates`；`POST /api/agents` 接受 `templateId` + overrides。
4. 新建 agent 弹窗：模板选择 + 角色卡预览 + 可编辑字段 + 知识包/工具选择。
5. 设置页支持换模板（保留 base prompt 的个性化部分）。
6. 模板可以另存为自定义（写回本地 `app/data/role-templates/`）。

## 5. 剩余工作与开发计划

### 5.1 完成度概览

| 模块 | 状态 | 还差什么 | 粗略工作量 |
|---|---|---|---|
| 协议/引擎/Matrix | ✅ 可用 | 并行化、更多测试 | 1–2d |
| 产品 UI（会话/群/私聊/媒体/搜索/设置/资料） | ✅ 可用 | 细节、键盘/移动端打磨 | 1–2d |
| 角色模板库 + 创建向导 | ⏳ 未做 | 模板、API、UI、知识包 | 1–2d |
| 成本控制 | ⏳ 未做 | triage、冷却、每 thread 预算、用量视图 | 2–3d |
| 工具审批/沙箱/流式 | ⚠️ 部分 | 审批 UI、流式输出、真正沙箱（现在只有 dontAsk + prompt） | 3–5d |
| Agent/房间生命周期 | ⚠️ 部分 | 删除/暂停/改名 agent、移除成员、邀请第二个人类 | 2–3d |
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

1. 角色模板库 + 创建向导（上面的 1–2 天）。
2. 成本控制：每 agent/thread 预算、冷却、廉价 triage；用量页。
3. 把“讨论轮次/链上限”变成可配置的护栏，不做强制。

**第 2 周：工具与治理**

4. 工具审批 + 真正沙箱（reviewer 只读、coder worktree）。
5. 流式输出（先文本流，再 tool_use 事件）。
6. Agent/房间生命周期：删除/暂停/改名、移除成员。
7. 数据平台最小版：审计/用量/会话检索。

**第 3 周：异构与多用户**

8. 第二个 runtime（OpenClaw/Codex）+ worktree。
9. 多人类/鉴权/邀请；房间 ACL。
10. 搜索分页/索引、运维打包。

**第 4 周：验证与收敛**

11. App/Web 测试 + CI。
12. “单 Claude + subagent” kill criterion 对比。
13. 根据结果决定：继续做产品，还是收敛成观测/治理层。

### 5.3 风险

- **成本**：角色越多、工具越活，turn 越贵；修测试实验 5 turn $2.16。没有 triage/预算前不适合放开多 agent。
- **权限**：现在 `dontAsk + allowedTools` 不是沙箱；reviewer 的只读靠 prompt。真正的工具隔离要 worktree/容器/审批。
- **角色泛滥**：模板太多会像“扮演”；先把 8 个软件团队角色打磨好，再扩。
- **多用户**：Matrix 账号/权限模型要重做，不能靠单一 human token。

> 批注：

## 6. 需要你拍板的点

1. 角色模板先做哪 8 个？是否以软件团队为主？
2. 知识包来源：先手工写 8 份精简角色卡，还是直接接 O*NET/ESCO 生成？
3. 工具权限模板：coder 可改仓库、reviewer 只读、researcher 可联网，是否接受？
4. 成本优先级：先做 triage/预算，还是先做角色模板？
5. 目标节奏：每天可用 vs 先验证 kill criterion。

> 批注：
