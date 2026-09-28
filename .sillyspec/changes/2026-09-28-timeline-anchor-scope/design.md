---
author: flow-machine-draft
created_at: 2026-09-28T10:17:49.919Z
---
# 设计记录（Design Record）— 2026-09-28-timeline-anchor-scope

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-timeline-anchor-scope 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
两件：① 后端 timeline.py 任务锚窗口收窄——anchor_pairs 仅由本变更 commit 事件的短哈希（rows kind=commit 的 detail 集）从全局 git 窗口筛出，锚匹配在 anchor_pairs 倒序进行；titles 映射仍用全局 50 窗口（标题展示用途与锚定无关）；本变更无 commit 事件 → 锚恒 None（无锚优于错锚）。② 前端 KIND_ICON 补 gate-run、config-change、fake-check-cleared、verify 四个新事件 kind 图标（上游 watcher-signal-widen 已发，渲染不炸不缺）。假勾选消解与停滞活跃信号由上游事件自然到位（fake-check-cleared 事件行 + gate-run 事件行），平台无需新推断。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-timeline-anchor-scope 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
timeline.py get_change_timeline 内 anchor_pairs 过滤（+11 行）+ test_timeline.py 增 scoped 用例（他变更同号 token 不抢锚、无窗口命中 None）；前端 change-timeline-card.tsx KIND_ICON 增四项。API 契约零变化（TimelineTask.commit_sha 语义收窄为仅本变更提交）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-timeline-anchor-scope 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：commit 事件与 git 窗口到达次序无关（聚合时快照读）。2. 并发写：只读聚合。3. 切换：无状态。4. 作用域：锚窗口=本变更 commit 事件集，跨变更零串台（正是修复本体）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-timeline-anchor-scope 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：本变更 commit 事件的短哈希在全局 50 窗口外（远端落后、窗口截断）→ anchor_pairs 空 → 锚 None——无锚是诚实降级优于错锚；titles 同理降级。放弃方案：锚匹配直接读 events 不经 git 窗口（事件只有短哈希无 message，token 匹配必须有 message——保留经窗口取对的形态只收窄窗口）。
