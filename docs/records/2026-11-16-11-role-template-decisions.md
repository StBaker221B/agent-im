# 2026-11-16-11 角色模板：批注与决策（过程记录）

- 记录时间：2026-11-16 下午。
- 性质：过程记录。正式状态见 [14 角色模板与开发计划](../14-role-templates-and-roadmap.md)。
- 关联：[09 角色模板](2026-11-16-09-role-templates.md) · [10 自主修测试](2026-11-16-10-autonomy-bugfix.md)

## 用户批注（原文/意图）

1. 角色是否需要自己的知识库？记录必要细节，以及使用者的个人预期。
2. 挑 star 高、受欢迎、开发者反馈多、使用者多的来源，整合；内容多多益善；冲突自己判断处理。
3. 角色至少覆盖软件开发、产品流程、公司经营；对业务、权责、边界理解要顶级；会解决问题、会沟通。
4. 先做哪 8 个？先从软件团队出发，需求和测试也要包括，以后向上下游扩展。
5. 知识包来源：有现成好的可以参考，不足自己补充。
6. 工具权限不必过于拘泥；角色定义职责，不是靠权限约束；权限控制在安全范围内、相对开放。
7. 成本控制和角色模板都做；角色模板先做；问 triage 是什么。
8. 问 kill criterion 是什么。
9. 文档是项目状态，批注应进过程文件；后面整理。

## 决策

- **先做 13 个内置模板**（含 generic）：
  - 软件：architect、coder、reviewer、qa、ops、security
  - 产品/需求：facilitator、product-manager、business-analyst、researcher、tech-writer
  - 公司经营：operations
  - 以后向上下游扩（marketing、sales、finance、support 等）。
- **角色卡 = 职责 + 边界 + 决策权 + 思维方式 + 沟通方式 + 交接 + 成功标准**，不是一行职位名。
- **角色自带知识包**：`app/role-knowledge/<id>.md`，写清工作方法、检查清单、权责边界、使用者预期、常见失败；运行时拼进 prompt。
- **知识分层**：workspace → room → role pack → agent private；创建时只覆盖差异。
- **权限观**：角色定义职责，权限是安全护栏；模板给相对开放的默认工具，但默认 cwd 是自己的 workspace；reviewer 的只读靠 prompt + 工具白名单，不是强沙箱。
- **来源**：MetaGPT/ChatDev 的软件团队职责、CrewAI 的字段、LangGPT 的结构；O*NET/ESCO 留作后续生成/扩充；prompts.chat 只做灵感，不原样导入。
- **顺序**：角色模板先做（已实现），成本控制紧随其后。

## triage / kill criterion（解释）

- **triage**：在跑完整模型 turn 之前，用规则或便宜的小模型先判断“这条消息需不需要这个 agent 回 / 该谁处理”。目的是减少 `human_all` 下 N 个 agent 每人一个完整 turn 的成本。
- **kill criterion**：00 合同里的止损条件：同一任务对比“多 agent IM” vs “单 Claude + subagent”，如果完成质量、token 成本、人类干预次数没有明显优势，就停止扩张，转为观测/治理层或个人工具。

## 已实现（2026-11-16）

- `app/role-templates.mjs`：13 个角色卡 + `renderRoleCard` + `readRoleKnowledge`。
- `app/role-knowledge/*.md`：13 份角色知识包。
- `GET /api/role-templates`；`POST/PATCH /api/agents` 支持 `templateId`、`toolsEnabled`。
- 新建 agent / 设置页支持模板选择、预览、工具开关；资料页/Agents 页显示模板。
- 现有 agent 迁移 `templateId`（coder/reviewer/researcher/generic）。

## 遗留

- 自定义模板另存、团队模板（一次建一组角色）还没做。
- O*NET/ESCO 自动生成角色卡还没接。
- 工具权限仍是弱隔离；真正沙箱/审批在后续阶段。
- 成本控制/triage 还没做。
