---
author: flow-machine-draft
created_at: 2026-10-03T05:43:23.076Z
---
# 设计记录（Design Record）— 2026-10-03-local-usage-caliber-fix

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-local-usage-caliber-fix 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
摄取侧口径归一：usage_ingest._ingest_one 落库 usage_input_tokens = max(0, inputTokens − cacheReadTokens)（非缓存输入，与平台 agent_runs/Anthropic 口径对齐；ZCode/GLM 总输入口径 113/113 实证 total=input+output）；下游命中率公式与「输入」展示语义零改动自动归正（49.6%→~98.3%）。聚合侧补缺：usage_service 本地段查询列加 MIN(first_seen)/MAX(last_seen)/SUM(invocations)——三元组参与（MIN/MAX + 耗时累加观察跨度，跨度 0 不动保 None 诚实值）、请求次数并入 api_requests（CLI 上报调用计数）；轮次仍无来源恒 0。前端仅注脚文案与「本地 CLI」行请求列 0→「—」有值直显。覆盖写幂等使活跃日志下次上报自动重算存量（节流 300s 窗口外）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-local-usage-caliber-fix 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无端点/DTO 签名变化。内部行为变化三处：①platform_agent_logs.usage_input_tokens 落库语义从「daemon 原文总输入」改为「非缓存输入」（存量旧快照在下次成功摄取时幂等覆盖为新口径）；②ChangeUsageRead/UsageSummaryRead 的 started_at/finished_at/duration_ms/api_requests 四个**既有字段**开始包含本地 CLI 段贡献（原先恒 None/0）——消费方（用量卡/列表执行列）零改动即得新值；③「本地 CLI」桶行 api_requests 从恒 0 变为 SUM(invocations)。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-local-usage-caliber-fix 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
①乱序：first/last_seen 取 SQL MIN/MAX 天然乱序免疫；ISO 串字典序=时间序（CLI 恒 UTC Z 协议），畸形串 _iso_to_dt 容忍返 None 跳过。②并发写：快照覆盖写幂等（全量解析整体替换），并发摄取同 entry 结果确定；聚合只读。③切换/中断：best-effort 摄取失败保持旧快照（不落半截——五列一次赋值后统一 commit）；时长跨度 last<first 畸形按 0。④作用域：本地段查询恒带 change_session_links/quicklog_session_links 锚点 + workspace 过滤，跨工作区不串台；naive/aware 时区混比统一过 _naive_utc 剥壳（SQLite 测试库丢 tzinfo 场景实测命中）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-local-usage-caliber-fix 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：口径切换期新旧快照并存（存量未重摄的旧口径行 input 偏大、命中率偏低）——活跃变更下次上报自动收敛，死日志不重算可接受（展示偏高不丢数）。放弃的方案：展示层按数据源分公式（本地 CLI 用 cache_read/input、平台用现行公式）——两口径数字混一张表仍费解、公式分叉扩散到三处组件；落库归一一处收敛全部下游，且与平台列语义同构。次要风险：invocations 与 api_requests 语义近似（CLI 留底计数 vs API 调用）非严格同义，注脚已声明。
