---
author: flow-machine-draft
created_at: 2026-10-19T05:36:14.829Z
---
# 设计记录（Design Record）— 2026-10-19-knowledge-inbox-triage

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

16 条按 uncategorized.md 文件头的定性口径判类（工具坑→sillyspec-gotchas / 测试坑→testing-gotchas / 架构可复用模式→patterns / 项目坑→known-issues / 约定与契约→conventions），与既有同族条目聚簇（如 worktree node_modules junction 坑并入 sillyspec-gotchas 既有 junction 族、daemon.start() 测试坑并入 testing-gotchas 的 daemon 族）。正文原样迁出保真（含来源变更名与日期），仅做三类最小改写：标题去掉已裁决的【待确认】前缀、known-issues 条目按既有 🟢/🟡 前缀口径加状态（🟢=已修复/已定案：生产嵌入定案 + 生产/本地索引损坏修复；🟡=现行有效：require_permission 422 / .zcode tracked / 首搜建库地雷）、条目尾补一行「状态（2026-10-19 归类核实）」裁决记录。INDEX.md 五节补 16 行索引（锚点用 GitHub slugger 规则脚本生成防手误），uncategorized.md 留清账记录。顺带修复 INDEX.md 中已在 HEAD 里的一行残留冲突标记（`||||||| C:/Users/12532/AppData/Local/Temp/d.base`，FR 索引节）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无代码接口变化。文件契约变化：① uncategorized.md 收件箱归零（16→0，保留 2026-09-28 与本次两条清账记录）；② 五个分类文件追加条目（known-issues 6 / testing-gotchas 4 / conventions 3 / sillyspec-gotchas 2 / patterns 1）；③ INDEX.md 五节 +16 行索引、Uncategorized 段补清账说明、删除 1 行残留冲突标记。`sillyspec knowledge search` 对新条目的可命中性依赖 INDEX 关键词行，关键词按既有行的粒度选取。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——纯静态文档迁移，无事件流；若并行会话在我读后改了同一知识文件，Edit 前以最新落盘内容重读基线。
2. 并发写：INDEX.md 正被并行变更（2026-10-19-thinking-zh-translate）持有未提交改动（删 auto-frontend 索引行，另有 8 个 fr/*.md 改删）。处置：我的提交用显式 pathspec；对 INDEX.md 采用「临时回插他侧行 → commit → 恢复其删除态」的 hunk 隔离，确保本变更提交面只含我的 hunk、其未提交态原样保留；五个分类文件与 uncategorized.md 经 git diff 核实无他人未提交改动。
3. 切换/生命周期：flow 轻量变更断点安全——全部工作为幂等文档编辑，中断重入无状态损坏；提交前 `sillyspec knowledge validate` 兜底。
4. 作用域：知识库为本仓单实例（`.sillyspec/knowledge/`），不跨工作区/跨仓；spec-sync 只上行不回改本地文件，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险①：INDEX 锚点 slug 手写错 → 索引断链。对策：用 node 脚本按 GitHub slugger 规则（小写、去非常量词符、空格→连字符）对 16 个标题生成锚点再写入，`knowledge validate` 兜底。
- 风险②：并行会话的 INDEX.md hunk 被我扫入提交。对策：显式 pathspec + `git diff --cached --name-only` 全量核对 + 临时回插隔离（见并发问 2），提交后核对工作区恢复其未提交态。
- 风险③：分类归属争议（如 node_modules junction 事件可归 known-issues 也可归 sillyspec-gotchas）。对策：按「与既有同族条目聚簇便于检索」原则定（junction 族→sillyspec-gotchas），争议归属在设计期即定死，收口不再摇摆。
- 放弃方案：走 `sillyspec knowledge propose` 逐条提议再人工合并——propose 仅写 `proposed/` 待人工审核，会产生 16 条待审噪音且仍需人工逐条合并，不满足用户「清账」目标；用户本次指令已明确授权直接归类，且直接编辑分类文件有 2026-09-28-knowledge-inbox-clear 同款先例，故放弃 propose 通道。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | .sillyspec/knowledge/uncategorized.md | 16 条迁出，收件箱归零 + 清账记录 |
| 修改 | .sillyspec/knowledge/testing-gotchas.md | +4 条（vi.doMock 代际冻结 / xfail 假绿 / daemon.start() 代理黑洞 / monkeypatch 双 patch） |
| 修改 | .sillyspec/knowledge/conventions.md | +3 条（pi 原生 MCP 配置 / MCP SDK registerTool / daemon mcp-server env 契约） |
| 修改 | .sillyspec/knowledge/patterns.md | +1 条（async rollback 后 MissingGreenlet） |
| 修改 | .sillyspec/knowledge/known-issues.md | +6 条（require_permission 422 / .zcode 已跟踪 / 生产嵌入定案 / 生产索引损坏已修复 / 本地索引复发已修复 / 首搜建库地雷） |
| 修改 | .sillyspec/knowledge/sillyspec-gotchas.md | +2 条（跨仓 worktree wt-commit / 并行会话删 node_modules 顶层链接） |
| 修改 | .sillyspec/knowledge/INDEX.md | 五节 +16 行索引 + Uncategorized 段清账说明 + 删 1 行残留冲突标记 |
