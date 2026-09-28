---
author: flow-machine-draft
created_at: 2026-09-28T08:46:09.452Z
---
# 设计记录（Design Record）— 2026-09-28-knowledge-gov-ux-detail

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux-detail 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） --
governance-cards.tsx 单文件二轮（数据链/动作通道零变化）：
- 「看得到才能处置」：每池/每域/收件箱加「查看明细」入口——router.push 同页深链 ?file=fr/<域>.md（伪域每池含 unmapped 与未知池如 auto-round5）/ fr/<域>.md（rot 分域 chip，detail 解析）/ uncategorized.md（收件箱），复用页面既有深链消费（参数组合变更即触发选中+滚动）。
- 「处理入口」：rot/inbox 加「复制 AI 处理指令」按钮——navigator.clipboard.writeText 复制即用提示词（含计数与分布，rot 带 tests confirm 语法、inbox 带 classify 目标文件口径）；clipboard 不可用/失败时内联展示提示词全文供手动复制（降级为展示非静默）。
- binding-unresolved 正文下补明细行（锚点 ID 列表，原版有数据未展示）。
>

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux-detail 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） --
无对外接口变化：GET/POST 端点未动，后端零改动。前端组件内新增交互：查看明细（router.push 本页查询参数，不新增路由）、复制指令（浏览器 clipboard API，非平台接口）；新增 testid：view-fr-<domain> / view-inbox-file / copy-ai-prompt-<kind> / copy-ai-prompt-result / copy-ai-prompt-fallback / governance-binding-detail / governance-rot-domains。
>

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux-detail 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） --
1. 乱序/迟到：detail 解析沿用 matchAll 容错（漂移→入口消失不误跳）；深链目标文件不存在时页面既有「查无此文件静默停列表」语义兜底。
2. 并发写：查看/复制均为本地导航与剪贴板操作，无服务端写；归位 mutation 并发语义沿用一轮（isPending 全池禁用）。
3. 切换/生命周期：router.push 软导航页面不重挂载，深链消费 ref 按参数组合去重（页面既有语义）；clipboard 状态仅组件内展示态。
4. 作用域：深链 URL 以 workspaceId 构造（既有鉴权上下文内）；提示词为纯文本无注入面（clipboard 写出，不经解释器）。
>

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux-detail 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） --
最大风险：深链文件名按域推导（fr/<domain>.md）依赖「伪域/rot 域名=文件名」约定——digest 的域名即 fr/ 文件名（unmapped/auto-*/lib-api 均实证），漂移时页面静默停列表（不报错不误导，可接受）；目标文件在 daemon 检出而非主仓（平台数据源即 daemon 视图，一致性天然成立）。放弃的方案：①rot/inbox 做成页面内向导（逐条分类表单/复核向导）——判断类工作做成表单比复制指令更重且假 automation；②后端加明细列表端点——digest 明细已够入口用途，完整数据在知识文件里且深链直达，后端零改动保 thin；③复制按钮换成「一键派发 AI 会话」——平台会话派发是独立大特性，不绑架本卡。
>
