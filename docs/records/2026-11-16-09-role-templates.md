# 2026-11-16-09 角色模板 + 私有知识实验

- 记录时间：2026-11-16 下午。
- 状态：角色模板/私有知识/角色 @ 别名完成；coder + reviewer 实验验证了"分工 + 信息不对称"能产生实质协作。
- 关联：[13 MVP 架构 §7.2](../13-mvp-architecture.md) · [09 协议 §14](../09-agent-protocol.md) · [08 讨论模式](2026-11-16-08-discussion-mode.md)

## 假设

群聊里 agent 同质化（同模型、同工具、同房间上下文、角色只是标签），所以不会互相补充/指正；给它们明确角色、分工、私有背景，才可能自然协作。

## 实现

- `app/store.mjs` 新增 `ROLE_TEMPLATES`：`generic / coder / reviewer / researcher`。
  - coder：给最小实现路线，用真实 @用户名 请求 review，收到 objection 必须回应；
  - reviewer：必须找具体风险/遗漏/反例并 @ 提案人，没有具体风险才 PASS；
  - researcher：查证/对比/依据/边界，前提不成立要指出。
- `composeSystemPrompt(agent)` = base systemPrompt + 角色模板 + 私有知识。
- 私有知识：`app/data/agents/<name>/knowledge/*.md`（≤12KB），只给该 agent。
- 设置页/新建 agent 增加「角色模板」选择；`PATCH /api/agents/:id {role}`；改 role/prompt 会重建 runtime。
- `@` 解析支持角色别名：如果某个 role 在房间里唯一，`@reviewer` / `@coder` 能解析到对应 agent；角色模板仍要求用真实 @用户名。
- 新建测试 pair：`@arch-coder`（coder）+ `@arch-reviewer`（reviewer），各自有私有 knowledge；群「登录方案评审」discussion 模式。

## 实验

问题：设计 agent-im 登录功能最小方案，给实现路线、安全风险、最终结论。

第一轮：

- coder 给出完整路线（state.json auth、四个路由、cookie 属性、审计、JWT 只做 capability），并请求 review（但写了 `@reviewer`，当时别名未生效，没解析；reviewer 是被 human_all 唤起的）。
- reviewer 逐条指出：`NODE_ENV` 判断 Secure 的失败场景、logout 必须 method 硬校验、Origin 缺失时的 Sec-Fetch-Site、sessions 与业务 store 同文件的并发/丢写、fsync/rename、改密踢设备、限流键用 socket、假哈希常量等；结论"采用，但有条件"。
- 2 条 agent 消息；reviewer 文本里有 2 处 objection-like；角色/知识明显提升了深度。

修正后第二轮（同一群，要求 coder 回应条件并确认）：

- coder 逐条接受条件，并主动修正 Windows 上 `fsync(dir)` 不可用的问题；`@arch-reviewer` 请求最终确认（mention 正确解析）。
- reviewer 确认 Windows 降级可接受，追加 rename 的 EPERM 重试、`.bak` 回退、tmp 清理、Windows chmod no-op 的提醒；`DONE` 冻结。
- 2 条 agent 消息，1 次 agent→agent mention；形成"提案 → 质疑 → 修正 → 确认"的闭环。

成本：4 个 arch-* turn 约 **$0.258**。

## 结论

- **角色标签不够，角色义务 + 私有信息 + 强制 review 才够**。同一对 agent 在通用提示下更多是"各答一次 + 一次纠正"；分工后出现了具体质疑、条件接受和最终确认。
- 信息不对称很关键：coder 知道项目约束，reviewer 有安全清单；双方都补了对方不知道的点（Windows fsync、rename 重试、备份回退）。
- 仍是同一个模型、同一套工具；真正的异构（不同模型/工具/权限）还没做，角色模板只是行为约束。

## 遗留

- knowledge 改完需要重启或触发 runtime 重建；没有热加载。
- 角色别名只在 role 唯一时生效；多个 reviewer 时 `@reviewer` 不解析，必须用真实 @用户名。
- 角色模板不改变工具/权限；coder 并不能真的改代码，reviewer 也没有只读限制。
- 没有任务看板/owner 制度；现在的分工靠 prompt 和 @。
- 测试群「登录方案评审」和两个 arch agent 保留，方便继续试。
