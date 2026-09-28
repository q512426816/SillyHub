---
author: flow-machine-draft
created_at: 2026-09-28T14:11:55.606Z
---
# 设计记录（Design Record）— 2026-09-28-fr-review-batch

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-fr-review-batch 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯知识库复核，不改业务代码。对 fr/ 九域 263 条「待复核」FR 条目逐条核对绑定与实态：先在小域 lib-knowledge（5 条）试点验证命令链，再按域分三波并行派子代理（波1 lib-api 64/daemon 56/frontend 31，波2 lib-changes 31/build 28/backend 26，波3 components-shared 15/styles 7）。每条裁决五档：①已有 candidate 绑定行且测试在盘相关 → `sillyspec tests --confirm --anchor <id> --evidence <测试路径>` 翻 active；②无绑定行但有真实覆盖测试 → `sillyspec tests --anchor <id> --bind --tests <路径> --reason spec --change <来源变更>` 直接写 active+agent 行；③绑定指向过时测试 → --unbind 旧行后重绑现行；④内容过时 → 最小修正场景正文；⑤特性已死 → 状态改 superseded + 退役理由。复核完成条目手工删除「待复核：」行（该行生命周期已从工具源码核实：rot 打标→digest 覆盖面清理/承接清除，人工复核后删除安全，机器仅在未来变更真实再覆盖时重打）。每波后 knowledge validate + 显式 pathspec 提交。选分域并行因各域文件互不相交、tests 命令仅写各自 fr 文件（源码核实无 DB 写），天然无竞争。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-fr-review-batch 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无代码接口变化。文件格式变化限于 knowledge/fr/<域>.md：①条目「测试绑定：」机器子块内行状态 candidate→active（经 sillyspec tests 命令，非手改）或新增 agent 绑定行；②删除复核完成条目的「待复核：」行；③个别条目场景正文最小修正或 状态：superseded + 退役理由。消费方为 sillyspec knowledge search/inspect 与 INDEX 路由——格式契约（标题/状态/场景正文/绑定子块结构）不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-fr-review-batch 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——静态文档复核，无事件流；同波子代理只写各自域文件。
2. 并发写：每波内子代理按域分工，文件互不相交；tests 命令原子写（writeAtomicSync，源码核实）；主会话在波间串行提交。同机并行会话若同时改 fr/，写前快照比对会跳过让重跑（工具自带并发安全），且本变更基线后 fr/ 无他人未提交改动（开工前 git status 已核）。
3. 切换/生命周期：每条目裁决独立落盘（命令即时写文件），波间提交形成断点；中断可按域续跑，flow done 支持断点续。
4. 作用域：仅本仓 .sillyspec/knowledge/fr/，tests 命令只在本仓根跑（规则 22），无跨仓串台。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-fr-review-batch 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：子代理为凑数把不相关的测试绑上去（橡皮图章绑定）——防御：子代理指令明确「测试必须真实覆盖该 FR 行为，拿不准就报『无测试面』不动绑定」；evidence 必须是测试形态文件（CLI 强校验）；主会话抽查各域非 confirm 类裁决。次风险：内容修正误判（把仍准确的条目改错）——防御：仅在被当前代码证伪时最小修正，拿不准归「保留待人工」不碰。放弃的方案：①主会话单线程逐条处理 263 条——上下文与时长爆炸，放弃；②一次性九域全并行——波间无校验断点、失败面大，改为三波。
