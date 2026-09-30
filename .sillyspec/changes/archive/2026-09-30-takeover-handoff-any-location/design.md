---
author: flow-machine-draft
created_at: 2026-09-30T07:27:52.459Z
---
# 设计记录（Design Record）— 2026-09-30-takeover-handoff-any-location

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-handoff-any-location 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
用户裁决修正（对话中二次收窄）：不做「任意在线机器」选择——仅把 handoff 档接手引擎候选对齐「新建会话 · 选择运行位置」的白名单（SESSION_SUPPORTED_PROVIDERS=claude/codex/pi/cursor，后端同源=PROVIDER_CAPS 四键）。执行位置仍锁原机（D-002 不变）。改动：前端 deriveTakeoverChrome 两处 engines 派生加白名单过滤；后端 takeover handoff 分支 session_capable 集合过滤 machine_providers/provider_rows，白名单外重选 422「不支持会话」独立文案，默认无白名单行 409「可会话引擎」文案。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-handoff-any-location 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
TakeoverRequest.provider 语义不变（可选重选）；重选校验集合从「原机全部 provider」收窄为「原机 provider ∩ PROVIDER_CAPS」；错误文案两分（白名单外 vs 原机没有）。前端 deriveTakeoverChrome 返回的 engines 恒为白名单内集合。无新端点/字段。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-handoff-any-location 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
乱序：不涉及（静态集合过滤）。并发：白名单为编译期常量无共享态。切换：422/409 先于写库无半成品。作用域：machine_rows 恒限会话属主，白名单全局常量不串台。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-handoff-any-location 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
测试：后端 test_takeover_handoff.py 增 openclaw 422「不支持会话」断言（6 用例绿）；前端 session-panel-takeover.test.tsx 增白名单过滤用例（7 用例绿）+ tsc/lint/mypy 零错。回滚=revert 单 commit（纯过滤与文案，无 schema 面）。死路：无。
