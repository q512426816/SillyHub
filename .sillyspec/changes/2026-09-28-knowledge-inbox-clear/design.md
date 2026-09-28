---
author: flow-machine-draft
created_at: 2026-09-28T13:37:18.188Z
---
# 设计记录（Design Record）— 2026-09-28-knowledge-inbox-clear

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-inbox-clear 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯知识库文档迁移，不改任何代码。逐条读取 `.sillyspec/knowledge/uncategorized.md` 的 41 条（40 个 `##` 条目 + 1 条丢标题的 SSE 路由条目），按内容归入五个既有分类文件：known-issues 18 条（项目坑/外部依赖行为，已修复项按文件既有惯例标 🟢 已修复、未修复现状项标 🟡）、patterns 6 条（可复用架构/设计模式）、conventions 5 条（仓库编码约定）、testing-gotchas 8 条（测试环境/方法论坑）、sillyspec-gotchas 4 条（SillySpec 工具行为坑）。正文忠实保留不删减，仅：补写丢标题条目的标题、更新指向 uncategorized 旧标题的 wiki 交叉引用、对两条条目追加经代码核验的现状备注（master key 健壮性缺口仍开放、后台子代理死锁已有宽限缓解）。INDEX.md 五个分类节补 41 行关键词索引，Uncategorized 节改为已清空说明。选此方案是因为五个分类文件与 INDEX 路由是仓库既有知识库结构，迁移而非重写可保留全部可回溯信息。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-inbox-clear 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无代码接口变化。文件格式变化：uncategorized.md 由 41 条内容缩减为仅收件箱头注 + 清账说明一行；known-issues/patterns/conventions/testing-gotchas/sillyspec-gotchas 五文件各追加 N 条 `##` 条目（沿用各文件既有标题格式）；INDEX.md 新增 41 行 `关键词 → [标题](文件#锚点)` 索引。消费方为 sillyspec knowledge search/inspect 匹配引擎与按关键词读 INDEX 的子代理——均为内容增量，无删除既有索引或条目（唯一改写点：known-issues 内 1 处「关联 uncategorized」交叉引用改为指向 conventions 新条目）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-inbox-clear 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯静态文档迁移，无事件流；条目按原文件顺序迁移，顺序不构成语义。
2. 并发写：同机存在并行会话（frontend-apple-style）。开工前已核实 INDEX.md 与五个分类文件在基线 4dfba3a2a 处干净、并行会话的知识面改动已提交；本变更只编辑上述 6 个文件并显式 pathspec 提交，不碰并行会话未跟踪的 `.sillyspec/changes/2026-09-28-frontend-apple-style/`。若并行会话中途再写 knowledge/，提交时 pathspec 圈定即隔离。
3. 切换/生命周期：中断安全——每文件一次完整写入，未完成文件不提交；flow done 支持断点续跑。
4. 作用域：仅本仓 `.sillyspec/knowledge/`，不触 worktree/其他仓，无跨实例串台面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-inbox-clear 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：INDEX 锚点手写错（GitHub 中文 slug 规则：标点删除、空格转连字符）致索引点击不可达——用 node 脚本按同规则自检 41 条锚点后跑 sillyspec knowledge validate 双保险。次风险：归类判断主观（个别条目跨类，如 Next.js 代理条目兼含 SSE 范式）——按条目主锚（主要教训）归类，正文整体迁移不拆条，不丢信息。放弃的方案：按条目拆分跨类内容到多个文件（破坏原条目完整性与可回溯性，放弃）；已修复条目删除（违背收件箱头注「已修复项保留并标注状态便于回溯」，放弃）。
