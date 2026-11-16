# 2026-11-16-10 自主性实验：修一个失败的测试

- 记录时间：2026-11-16 下午。
- 状态：进行中（真实沙箱 + 工具 + coder/reviewer）。
- 关联：[13 MVP 架构](../13-mvp-architecture.md) · [09 协议 §14](../09-agent-protocol.md) · [09 角色模板](2026-11-16-09-role-templates.md)

## 目的

不再用“讨论轮数”强制 agent 说话，而是给它们一个**必须靠工具和彼此才能完成**的任务，观察是否出现自主的 handoff 和迭代。

## 实验设置

- 沙箱仓库：`app/data/experiments/bugfix`（真实 Node 项目，`npm test` 有 4 个失败）。
- `@fix-coder`（coder）：cwd 是沙箱；允许 `Read/Glob/Grep/PowerShell/Edit/Write`。
- `@fix-reviewer`（reviewer）：同一 cwd；允许 `Read/Glob/Grep/PowerShell`，prompt 要求只读。
- 私有知识：coder 知道“可以改 src、不能改 test”；reviewer 有边界检查清单。
- 群「修测试实验」discussion 模式；任务：
  > 让 `npm test` 通过。可以修改 `src/`，不能改 `test/`。先复现失败，再修；修完请 @fix-reviewer 用测试和边界场景确认。

## 实际过程（一条人类消息，零人类催促）

1. 任务里点名了 `@fix-reviewer`，它先拿到 floor：
   - 用 PowerShell 跑 `npm test`，复现 4 个失败；
   - 用 Read 看 `src/money.mjs`、测试和 spec；
   - 指出 coder 还没动手，列出测试没覆盖的边界（空串、纯空白、`"$"`、括号不配对、`Infinity` 等），并 `@fix-coder`。
2. coder 拿到 floor：
   - 一开始用相对路径 `cd app/data/experiments/bugfix`（cwd 已经是沙箱，命令失败）；
   - 改用绝对路径 Read src/test/spec；
   - 用 Edit 重写 `src/money.mjs`（parseAmount 校验、average 空数组、formatAmount 分组、half-up `toCents`）；
   - 用 PowerShell 跑 `npm test` 和额外边界探针，5/5 通过；
   - `@fix-reviewer` 交付，说明只改了 src、测试未动。
3. reviewer 再次拿到 floor，跑测试和边界探针复核：
   - 5/5 通过，`test/` 未变（25 行、mtime 早于 src）；
   - 前一轮边界全过（`1.005→1.01`、`-1.005→-1.01`、`format(-0)="$0.00"`、非法输入等）；
   - **发现一个测试没覆盖的真实不对称**：`parseAmount("-$5")` 会抛错，而 `formatAmount(-5)` 自己输出 `-$5.00`——自己的输出解析不回来；
   - `@fix-coder` 要求补这一处并复验。
4. coder 再拿到 floor：
   - 把 `$` 剥离抽成 `takeDollar()`，在符号前后各处理一次；
   - `-$5` 和 `$-5` 都合法，重复符号/括号内重复负号仍抛错；
   - `npm test` 仍 5/5，`parseAmount(formatAmount(-5)) === -5`；
   - `@fix-reviewer` 复验。
5. reviewer 最终复验：5/5、`test/` 未动、全部边界通过，“可收工”。

## 结果

- **一条人类消息，5 个 agent turn，0 次人类中途干预**。
- 工具调用：reviewer 21 次 PowerShell + 5 次 Read；coder 11 次 PowerShell + 5 次 Read + 2 次 Edit。
- 轮次由环境反馈（测试失败/通过）和角色义务驱动，不是强制轮次，也不是人类催。
- 测试 5/5 通过；`test/` 文件未改（mtime/内容都核对过）。
- 成本：5 个 turn 约 **$2.16**。小任务但工具探查充分，成本偏高。

## 结论

- **在“有真实失败、有工具、有信息差”的场景里，agent 能自主沟通协作**：
  - reviewer 自主复现并定义边界 → coder 自主修改并验证 → reviewer 自主复核 → reviewer 发现测试没覆盖的真实 bug → coder 再修 → reviewer 复验通过。
- 交互不会无限进行：reviewer 认为通过就收工；该停时停也是自主。
- 角色模板 + 私有知识 + 工具/权限 + 环境反馈，比“强制多轮”更能产生真实协作。
- 成本是现实问题：这个小任务 5 turn 约 $2.16；需要工具权限收窄、预算/冷却和更便宜的 triage。

## 局限

- 任务里点名了 `@fix-reviewer`，所以 reviewer 先拿 floor；后续的 handoff 和 bug 发现是 agent 自主完成的。
- 工具权限是 `dontAsk + allowedTools`，不是强沙箱；reviewer 只读靠 prompt 约束，PowerShell 仍可写。
- 这个实验的 cwd/tool allowlist 写在本地 `state.json`，没有产品 UI。
- 沙箱在 `app/data/experiments/`，gitignored；knowledge 也是本地数据。
