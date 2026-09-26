---
author: flow-machine-draft
created_at: 2026-09-26T11:47:46.140Z
---
# 设计记录（Design Record）— 2026-09-26-knowledge-card-machine-block

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-knowledge-card-machine-block 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯前端展示层修复：entry-card-list.tsx 的 parseDecisionEntries 增加测试绑定机器块状态机（形态对齐 sillyspec src/test-bindings.js renderBindingBlock：空值「测试绑定：」头 + `<!-- test-bindings:` 注释标记 + `- row:` 行 + 两空格缩进键值行）。机器块解析为结构化 testBindings（rowId/tests/state）由卡片以紧凑只读行渲染（muted mono 块，rowId 进 title 溯源）；空值「测试绑定：」字段头撤出字段网格；块外的整行 HTML 注释一律不进正文（与原文 tab 口径一致——md 渲染下注释本就不可见）。选结构化而非整块隐藏：tests/state 是 FR 覆盖面的有效信号，隐藏会丢信息。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-knowledge-card-machine-block 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无后端/端点/文件格式改动。前端模块内导出新增类型 TestBindingRow 与 DecisionEntry.testBindings 字段（组件内部契约，无外部消费方）；解析行为变化仅限 decisions/fr 结构化卡：机器块不再落入 fields/body、整行 HTML 注释不再出现在正文。手册/INDEX/single 三形态零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-knowledge-card-machine-block 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯单文件同步解析，无事件/输入乱序面。
2. 并发写：不适用——前端只读渲染，不写知识文件。
3. 切换/生命周期：解析是纯函数无状态；机器块状态机遇到下一个 `##` 条目头或顶格非块内容即退出，旧文件（无机器块）零影响（既有 15 用例回归全绿）。
4. 作用域：不适用——组件级渲染，不跨工作区/仓；多实例渲染各自内容互不影响。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-knowledge-card-machine-block 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：对 writer 格式演进的耦合——tests 多值连接符 " | "、两空格缩进、字段集是 sillyspec test-bindings.js 的现行形态，CLI 侧改形态时这里需跟（宽容匹配注释标记前缀已留余量；tests 用 "|" split 天然容忍多值）。试过放弃的方案：①整块隐藏机器块——丢 tests 覆盖信号，放弃；②后端解析透传结构化字段——动 openapi/api-types 面大，展示层问题展示层解决，放弃。另注：knowledge-page 既有深链用例在 jsdom 下有 scrollIntoView 未实现的既有报错噪音（与本次无关，昨日引入）。
