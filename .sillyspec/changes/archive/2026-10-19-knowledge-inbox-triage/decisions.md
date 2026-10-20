---
author: flow-machine-draft
created_at: 2026-10-19T05:45:30.900Z
---
# 决策记录（Decisions）— 2026-10-19-knowledge-inbox-triage

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险①：INDEX 锚点 slug 手写错 → 索引断链。对策：用 node 脚本按 GitHub slugger 规则（小写、去非常量词符、空格→连字符）对 16 个标题生成锚点再写入，`knowledge validate` 兜底。 - 风险②：并行会话的 INDEX.md hunk 被我扫入提交。对策：显式 pathspec + `git diff --cached --name-only` 全量核对 + 临时回插隔离（见并发问 2），提交后核对工作区恢复其未提交态。 - 风险③：分类归属争议（如 node_modules junction 事件可归 known-issues 也可归 sillyspec-gotchas）。对策：按「与既有同族条目聚簇便于检索」原则定（junction 族→sillyspec-gotchas），争议归属在设计期即定死，收口不再摇摆。 - 放弃方案：走 `sillyspec knowledge propose` 逐条提议再人工合并——propose 仅写 `proposed/` 待人工审核，会产生 16 条待审噪音且仍需人工逐条合并，不满足用户「清账」目标；用户本次指令已明确授权直接归类，且直接编辑分类文件有 2026-09-28-knowledge-inbox-clear 同款先例，故放弃 propose 通道。
