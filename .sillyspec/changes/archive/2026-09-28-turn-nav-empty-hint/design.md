---
author: flow-machine-draft
created_at: 2026-09-28T02:37:49.047Z
---
# 设计记录（Design Record）— 2026-09-28-turn-nav-empty-hint

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-empty-hint 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
生产实证（46 轮群聊会话 API 直查）：14 轮 turn-outline 的 prompt/answer 摘要均为空——逐轮 run_id 直查证实这些 run 仅含 1 条 content 为空串的 user_input 日志（群聊轮用户正文存群消息表，agent 日志只留空记录），大纲如实返回空。前端占位文案「未加载 — 点击加载该轮并定位」语义错误：轮次状态/时间已在大纲中（非未加载），指令文案也多余。修法：三处同源占位（TurnNavList 浮层行/Drawer 行/旧 TurnCatalog aria 后缀）改中性——浮层与 Drawer 显「（无内容记录）」（muted），旧组件 aria 后缀缩为「· 未加载」；「未加载」状态语义保留在 aria-label 与视觉降调，不动数据链路（群聊摘要跨表兜底列为已知限制，本变更不做）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-empty-hint 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无接口/props 变化。纯前端文案常量：turn-nav-list.tsx 的 UNLOADED_HINT→EMPTY_HINT、session-panel-page.tsx 的 TURN_NAV_UNLOADED_HINT 值改「（无内容记录）」、turn-catalog.tsx aria 后缀去指令段；测试断言同步（3 文件）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-empty-hint 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：静态文案常量，无时序面。2. 并发写：无状态。3. 切换/生命周期：无状态。4. 作用域：文案变化不影响数据口径；「未加载」aria 语义保留（读屏可辨已加载与否），已加载与未加载轮的视觉降调不变。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-empty-hint 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：无摘要轮与「确实坏了的大纲」混淆——用户看到「（无内容记录）」可能仍疑惑。对策：本变更实证了空摘要=空数据（非故障）；若后续群聊摘要兜底（group message 表取正文）立项，该占位自然消减。放弃的方案：后端跨表取群消息正文兜底——超出文案修正范围且需群聊数据链路验证，另立变更。
