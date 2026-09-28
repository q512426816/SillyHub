---
author: flow-machine-draft
created_at: 2026-09-28T14:40:31.962Z
---
# 设计记录（Design Record）— 2026-09-28-change-detail-header-overflow

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-detail-header-overflow 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
两处 CSS 约束补齐（与列表行 2026-09-28-change-ux-detail-batch ① 同类陷阱）：
1. `frontend/src/components/layout/page-header.tsx`：header flex 行的左侧内容列 `<div>` 补 `min-w-0`——flex 项默认 min-width:auto，其内 nowrap 长文（详情页描述行 w-full+truncate）的 min-content 把该列撑到 1861px（生产实测），溢出 header（1228px）并产生页面级横向滚动（scrollWidth 2219 > 视口 1600）。补 min-w-0 后整条收缩链打通：列可收缩 → p/副标题 flex-wrap 受限 → 描述 span w-full=受限宽 + truncate 生效出省略号。组件级修复覆盖全部 41 个使用 PageHeader 的页面。
2. 详情页标题 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:244`：flex 行内 `<span className="truncate">` 补 `min-w-0`——同为 flex 项 min-width:auto 陷阱，超长标题目前无法收缩截断，防下一起同型报告。
方案选择：改组件而非详情页局部包一层 overflow-hidden——根因在 PageHeader 的宽度约束链，组件级修复一处收口全部使用方；且 min-w-0 只放宽收缩下限，对正常宽度内容零视觉影响。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-detail-header-overflow 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无对外接口/端点/文件格式变化。仅两处 className 变更：
- `PageHeader`（`frontend/src/components/layout/page-header.tsx`）渲染产物的左列 div 由无类变为 `min-w-0`，DOM 结构不变；
- 详情页标题 span className `truncate` → `min-w-0 truncate`。
可见行为变化唯二：超长描述/标题截断出省略号、页面横向滚动消失。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-detail-header-overflow 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯展示层 CSS 约束，无输入/事件时序。
2. 并发写：不适用——无共享可变状态；两处均为静态 JSX 类名。
3. 切换/生命周期：不适用——无会话/请求态；渲染中断重入结果一致。
4. 作用域：不适用——前端样式不跨工作区/实例持久化；PageHeader 组件级变更对 41 个使用方语义一致（仅放宽收缩下限，不改变数据流）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-detail-header-overflow 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：PageHeader 被 41 个页面共用，min-w-0 理论上改变极端长内容页的既有视觉（原先溢出可见、现在可能截断）——但「溢出可见」本身就是缺陷态，且正常宽度内容不受影响；jsdom 单测锁定类名在场，Playwright 生产复测定格几何。
试过放弃的方案：仅在详情页 subtitle 外包一层 `overflow-hidden` 容器——放弃：治标（裁掉溢出但不恢复截断省略号语义），且不动组件会留下其余 40 个使用方的同型隐患。

另注：三断点纪律的①spec/②执行断点按会话自主模式跳过等待（用户为报障式请求、修复面两行 CSS、根因有生产实测锚定），③归档断点结果照常汇报。
