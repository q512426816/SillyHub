---
author: flow-machine-draft
created_at: 2026-09-25T01:54:21.475Z
---
# 设计记录（Design Record）— 2026-09-25-knowledge-quick-legacy-copy

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-quick-legacy-copy 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯文案面四处同步（依据 2026-09-25 两子代理核对结论「知识库弹层是 quick 源另一入口未同步存量口径」）：precipitate-dialog 蒸馏源标签「快速修复（存量）」+空态退役说明+提示文案、distill-task-bar 摘要、distill-history-dialog 来源头、knowledge/page.tsx 头注释；口径与变更中心已落的存量退役表述一致（2026-09-25-change-center-thin-flow）。两处字面量断言跟新口径（distill-task-bar:344、distill-history-dialog:82）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-quick-legacy-copy 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无对外签名/行为/文件格式变化：仅 UI 展示字符串（SOURCE_TYPE_OPTIONS 标签、SOURCE_EMPTY_TEXT、sourceSummary/sourceText 文案）与注释；source_type 值仍为 "quick"、蒸馏请求载荷与后端校验零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-quick-legacy-copy 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：静态文案常量，无时序面——不适用。2. 并发写：无共享可变状态，纯渲染串。3. 切换/生命周期：无状态无生命周期面——不适用。4. 作用域：文案为编译期常量全局唯一份，无跨工作区/多实例差异。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-quick-legacy-copy 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：文案改动破坏依赖字面量的组件测试——已排查命中面（precipitate:509 为子串匹配兼容；task-bar:344/history:82 两处已跟新口径）并实测三组件 38 用例全绿。试过放弃的方案：直接隐藏/移除「快速修复」蒸馏分段——放弃，存量 QUICKLOG 条目仍需可蒸馏（thin-flow 设计钉死保留存量读通道），隐藏会切断存量收尾能力。
