---
author: flow-machine-draft
created_at: 2026-10-03T06:18:22.540Z
---
# 设计记录（Design Record）— 2026-10-03-usage-backfill-script

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-backfill-script 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
一次性运维脚本 backfill_agent_log_usage.py：候选查询（白名单 format+已关联会话+无快照+无 runs 二选一，与聚合消费口径逐条一致）→ 逐条复用 AgentLogUsageIngestService._locate_row/_ingest_one（定位 daemon→RPC 解析→归一落库全走既有已测链路）→ 末尾单次 commit，每 50 条进度回报。dry-run/--apply 两段式照 reset_agent_log_attribution.py 先例。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-backfill-script 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无端点/DTO/表结构变化。新增运维入口：backend/scripts/backfill_agent_log_usage.py（uv run python scripts/…，dry-run 缺省 / --apply 执行）；只写 platform_agent_logs.usage_* 五列，不触碰元信息/归属列。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-backfill-script 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
①乱序：候选按 log_path 排序输出稳定；usage_parsed_at IS NOT NULL 幂等排除，重复跑只补上次失败。②并发写：与在线摄取（上报触发）可能同时写同一行——两者都是全量覆盖写（整文件解析幂等同值），末态一致；脚本侧无锁需求。③切换/中断：逐条独立，中断已 commit 段保留、重跑续补（候选条件自动排除已完成）；daemon 离线条目跳过可重跑。④作用域：候选查询无 workspace 过滤（全平台一次性运维，跨 workspace 回填各自归属行——行内 workspace_id 自带归属，无串台面）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-backfill-script 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：daemon 离线导致大面积跳过（回填不完整）——设计为可重跑补齐，且每条独立降级不影响其他；历史日志文件已被用户清理的条目 RPC not_found 跳过（诚实缺数）。放弃的方案：写进 alembic 迁移自动跑——链内破坏性/外部依赖（RPC）不可入迁移（reset 脚本先例同裁决）；逐条即时 commit——无必要（幂等覆盖写无中间态语义）。
