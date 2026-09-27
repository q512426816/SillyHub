---
author: flow-machine-draft
created_at: 2026-09-27T14:08:32.244Z
---
# 设计记录（Design Record）— 2026-09-27-session-fast-replay

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-fast-replay 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
诊断（双子代理调研实证）：回显慢的根因是「按日志行翻页」而非「按轮」——44 轮会话 1.1 万条日志，400 条/页需几十次串行往返；每条日志含 tool result 全文 TEXT（单页数 MB）；/runs 全量 500 条含 system_prompt 原文无 gzip 且每轮重拉；TurnCatalog 30px 窄轨命中区 18px 两次扩容仍被抱怨、600 轮密度失效、>500 轮截断。对标 deepseek-harness（本地源码调研）：打开只取尾页窗口（约 50 条消息）+ 服务端全轮大纲投影一次下发，点旧轮 loadThrough 直达；「秒开」= 少加载+服务端缓存，不是虚拟滚动。
方案（对齐该模式）：①后端新增 turn-outline 端点——runs 轻列全量 + 窗口函数抽每 run 首条 user_input/reply 摘要（PARTITION BY run_id, channel），进程内 LRU 缓存按数据指纹失效（hermes coldLogMemo 同款思路）；②/logs 增 run_id 单轮直达与 slim 截断（tool content 2000 字符 + content_truncated 标记），配套单条全文端点；③/runs 剥 system_prompt（前端实证仅消费 name）+ gzip；④前端打开并行 [大纲+尾页(slim)]，未加载轮点击 run_id 直达（interval 循环翻页退役为回退），触顶翻页保留；⑤TurnCatalog 重做常驻行式导航列（大纲全量数据源，未加载轮有摘要）。选此方案因为三层数据问题（分页单位/payload/投影缺失）与导航形态同根，仅调前端参数（方案 B）治标不治本。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-fast-replay 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
接口契约：①GET /api/daemon/sessions/{session_id}/turn-outline → SessionTurnOutlineRead {session_id, total_turns, items:[{run_id, seq, created_at, started_at, finished_at, status, error_code, sender_name, engine_anchor, auto_resume_of, input_tokens, output_tokens, prompt_summary, answer_summary}]}（新 DTO，进 openapi/gen:types）；②GET /sessions/{id}/logs 新增 query：run_id（UUID，单轮日志升序上限 2000，不属于该会话 404）、slim（bool 缺省 false——tool 通道 content_redacted 截 2000 字符，DTO AgentRunLogEntry 增可选 content_truncated: bool）；③GET /sessions/{id}/logs/{log_id} → AgentRunLogEntry 单条全文；④GET /sessions/{id}/runs 响应 agent_profile_snapshot 剥 system_prompt 键（结构不变仅去键）+ gzip。前端 lib 层新增 getTurnOutline/getAgentSessionLogFull，getAgentSessionLogs 参数扩展；组件层 TurnCatalog → TurnNavList（新形态，props 契约：entries/onJump/activeTurnKey 载体保留）。既有端点默认行为零变化（不传新参数=旧行为）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-fast-replay 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：大纲缓存指纹含 max(log.timestamp)+max(log.id)——SSE 实时新日志落库后指纹变化，下次大纲请求拿到新轮；进行中轮在大纲中 status=running，前端 SSE 事件照常驱动（大纲仅导航元数据不进消息流装配链，与 displayTurns 覆盖逻辑互不干扰）。
2. 并发写：缓存读时指纹比对（乐观失效）而非写时失效——并发写与读竞态最多产生一次过期大纲（下一轮指纹变化即纠正），无锁；单条全文/单轮日志为只读端点无并发写面。
3. 切换/生命周期：大纲按 sessionId 维度请求与缓存（LRU 键=会话 id），会话切换自然隔离；前端跳转直达 prepend 复用既有复合游标去重（ts+id）与锚钉回机制，滚动位置语义不变；内存缓存在进程重启后自然重建（首读重算，正确性不受影响）。
4. 作用域：全部端点带既有归属闸门（get_agent_session 404 不泄露存在性）；slim 截断是传输层语义，落库原文不变（审计/导出全文照旧）；run_id 校验与 session 归属绑定防跨会话读。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-fast-replay 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：跳转直达的 prepend 装配链——单轮日志直接进 logsToTurns 需与既有 turns 正确衔接（复合游标去重依赖 ts 排序，单轮请求升序返回天然满足）；防护=复用既有 prepend 锚钉回+会话纪元防串台机制，测试覆盖跨页边界（目标轮与已加载窗口相邻/重叠两种情形）。第二风险：大纲摘要 SQL 窗口函数在超大日志表（15 万行）上的成本——指纹缓存吸收重复读，首算成本 DB 端扫描无传输（可接受；若实测慢再上物化投影，本次不做）。
试过放弃的方案：①全量历史虚拟滚动（@tanstack/react-virtual）——治渲染不治传输，且动态高度虚拟化复杂度高，hermes 实证聊天流不需要（窗口小），放弃；②大纲落库物化表+触发器维护——正确性最好但写路径侵入大，首版用指纹缓存（读时失效），实测不够再升级，放弃先行；③/runs 改分页——大纲端点已承担全量轻列职责，runs 保持现状语义只瘦身，避免双端点职责重叠。
