---
author: flow-machine-draft
created_at: 2026-09-30T06:59:16.541Z
---
# 设计记录（Design Record）— 2026-09-30-takeover-tier3-ambiguous-msg

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-tier3-ambiguous-msg 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
takeover.py 的 _fail 按场景分三态文案：歧义（多机命中）列出全部命中机器名并指引清理非本机 allowed_roots 或重跑 CLI 上报；有身份无在线（原文案保留）；无身份无命中（说明「历史上报未携带机器身份」+ 指引 allowed_roots 配置）。details 增 machine_candidates 机器名列表。选文案修复而非自动选机：无机器身份时无可靠信号区分原机，宁拒不猜（D-002@v1）不变。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-tier3-ambiguous-msg 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
HTTP_409_TOOL_REPORT_TAKEOVER_NO_MACHINE 的 message 文案三态化 + details 新增 machine_candidates（list[str]，空=无命中场景）。无签名/端点变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-tier3-ambiguous-msg 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
乱序：不涉及（错误文案组装纯读候选行快照）。并发：候选读取与判定同事务同源。中断：409 先于任何写库无半成品。作用域：候选域恒限会话属主 runtime 不跨用户。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-tier3-ambiguous-msg 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
风险：机器名含 runtime.name 为空时回退 id 短码（文案仍可诊断）。死路：无——三种失败态各有明确指引。回滚=revert 单 commit（纯文案+details 字段，无 schema/协议面）。
