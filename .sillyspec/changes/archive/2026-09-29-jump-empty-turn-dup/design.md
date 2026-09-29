---
author: flow-machine-draft
created_at: 2026-09-29T00:09:15.861Z
---
# 设计记录（Design Record）— 2026-09-29-jump-empty-turn-dup

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-jump-empty-turn-dup 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
session-panel-page.tsx handleJumpToTurn 单轮直达路径两处修补：①新增 `jumpEmptyJumpedRunIdsRef`（Set&lt;string&gt;）幂等标记——直达拉回的日志装配后无可渲染正文（segments/output 全空，群聊空 user_input 形态）时记名该 run，该轮后续点击直接定位高亮、不再发 run_id 请求；会话切换时重置（新会话同名 run 日志形态可能不同）。②prepend 门控——零正文（或装配无产出）不再 prepend：run_id 直达与已装配状态同日志源，重拉必同形，prepend 只会造装饰键（jump-&lt;该轮最旧日志id&gt; 恒相同）撞 React key 的重复空块。用 ref 而非 state：handleJumpToTurn 的 deps 刻意不含 turnState（防每帧重建击穿导航列 memo），原 loadedTurn 查找受陈旧闭包拖累本就不可靠（本次诊断实证），ref 读取恒当前。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-jump-empty-turn-dup 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无对外签名/端点/文件格式变化。组件内部新增一个 ref 与一处 prepend 条件分支。既有行为不变面全部保留：有正文轮的单轮直达（一次请求 + prepend + 定位高亮 + 零翻页）、请求失败回退 interval 翻页、run 无日志「该轮次日志不存在」兜底、loadedHasBody 已加载短路。新增回归测试 1 例（sessions page.test.tsx，先红后绿实证）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-jump-empty-turn-dup 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：标记只记「该 run 直达拉回零正文」这一已发生事实，与迟到大纲/快照无交互；SSE 后续若为该 run 增量上正文，走既有 SSE 覆盖链正常渲染——标记只拦重复直达请求，不拦 SSE。切会话后迟到的直达响应由既有纪元/卸载守卫丢弃。
2. 并发写：导航点击是用户串行动作，ref Set 读写都在事件回调内（React 合成事件无并发交错）；双击竞态下两次直达同源同形，Set.add 幂等，无脏态。
3. 切换/生命周期：会话切换重置 effect 内清空标记（与 setTurnOutline(null) 同点）；卸载后 ref 随组件回收，不落任何外部存储。
4. 作用域：标记是组件内存态，不进 localStorage/后端——跨工作区/跨实例天然隔离；同一会话内 run_id 唯一，无同名撞车。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-jump-empty-turn-dup 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：把「日志在窗口外」误判为「零正文」导致内容永不加载——不会发生：判定基于本次 run_id 直达拉回的**全量** run 日志（该请求不受游标窗口限制），拉回有正文即照旧 prepend；仅拉回全空才标记。试过放弃的方案：①「turn 在 turnState 存在即视为已加载不再拉」——孤儿空壳（displayTurns 补建/翻页空壳）不在 turnState 或因陈旧闭包查不到，且壳轮的日志可能在已加载窗口之外、首点必须拉，存在性判定会弄丢首次加载机会；②「扩 loadedHasBody 判定条件」——治标不治本，陈旧闭包（deps 无 turnState）下二次点击依旧查不到首次 prepend 的轮。ref 标记不受闭包影响，是稳态判定。实证：stash 掉修复跑新用例红（expected 2 to be 1——二次点击重复直达），恢复后绿。
