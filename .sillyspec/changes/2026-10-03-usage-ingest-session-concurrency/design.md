---
author: flow-machine-draft
created_at: 2026-10-03T03:37:59.554Z
---
# 设计记录（Design Record）— 2026-10-03-usage-ingest-session-concurrency

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-ingest-session-concurrency 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
选「定位段串行化」：`ingest_for_push` 先在并发区外逐条串行调
`_resolve_agent_log_read_target`（它是摄取路径上唯一吃 session 的环节——内部
至少 3 处 `await session.execute`，见 router.py:712/744 及两个 downstream 定位
函数），收集 `(row, daemon_id)` 对；随后 `Semaphore(3)` 只包住纯 RPC 段
（`_send_agent_log_rpc` 经 ws hub，不经 session）与覆盖写赋值（纯内存 ORM
属性赋值，无 DB IO），gather 后统一 commit。AsyncSession 并发禁令由此解除。
放弃「任务内自开 session」：row 对象绑定外层 session 的 identity map，跨
session 改写需按 id 重查再合并，复杂度高且引入双 session 事务边界；串行定位
的代价（每 entry 3-4 个本地毫秒级查询，一批 ≤50）可忽略。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-ingest-session-concurrency 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
仅 `backend/app/modules/platform_sync/usage_ingest.py` 内部重构：`_ingest_one`
签名从 `(row)` 改为 `(row, daemon_id)`（定位职责上移到 `ingest_for_push`
串行段）；模块级入口 `fire_usage_ingest_for_push` /
`run_usage_ingest_for_push` 与类公开方法 `ingest_for_push` 签名不变。端点、
DTO、数据库列、openapi 均零变化。顺手修复：`AgentLogTotalUsage.model_validate`
挪进 `_ingest_one` 的 try 保护圈内——畸形 totalUsage 不再炸出 gather 丢弃
同批已成功条目（批次放大缺陷）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-ingest-session-concurrency 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：上报天然乱序到达——快照是全量覆盖写幂等，最后一次解析胜出，
   与到达顺序无关；节流按 size+mtime+parsed_at 判定，日志未增长不重解析。不变。
2. 并发写：单任务内定位串行、RPC 段按行各改各的 ORM 对象（赋值无 DB IO）；
   两个 backend 实例并发摄取同一行仍是「覆盖写同值」幂等语义，无增量累加。
3. 切换/生命周期：fire-and-forget 任务进程退出被取消=该批丢弃，下次上报
   幂等补齐（既有语义不变）；session 在任务体 `async with` 内，异常路径也
   回滚关闭。
4. 作用域：定位用 `PlatformSyncAuthScope(workspace_id=row.workspace_id)`
   逐行自构造，workspace_id 来自已认证 scope 透传，行内归属校验恒匹配；
   快照列挂在行上，无跨工作区串书面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-ingest-session-concurrency 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：串行定位段拉长任务总时长——上限 50 entry × 每次 3-4 个本地查询，
毫秒级/条，远小于 RPC 段本身（30s 预算/条），可忽略；若 daemon 全离线，
定位仍逐条走完（每条查询+404 抛出），属既有降级路径的既有代价。
放弃方案：① 任务内自开 session（identity map 跨 session 改写复杂，见槽1）；
② 定位整体改为候选筛选时一次性批量 JOIN 查询——需改动 router 共享函数
`_resolve_agent_log_read_target`，牵连 content/messages 两端点，超出本缺陷
修复范围。
