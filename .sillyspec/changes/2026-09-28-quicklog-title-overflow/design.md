---
author: flow-machine-draft
created_at: 2026-09-28T15:35:32.307Z
---
# 设计记录（Design Record）— 2026-09-28-quicklog-title-overflow

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-quicklog-title-overflow 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
三处改动（frontend/src/components/changes/quicklog-table.tsx）：
1. DataTable 加 `tableLayout="fixed"`——antd 默认 auto 布局下列宽按内容 min-content 协商，标题列（唯一无 width 列）实际分得 ~400px 而标题按钮 `max-w-[420px]` 自适应内容宽，按钮连同 truncate span 直接越过单元格右界压进负责人/影响模块列（生产实测 elRight 875 > cellRight 854，用户 sillyspec 工作区实证）；fixed 布局下标题列稳定分得剩余宽度，截断有确定边界。
2. 标题按钮 `max-w-[420px]` → `block w-full min-w-0 max-w-[420px]`——宽度跟随单元格（宽屏保留 420 视觉上限，窄屏收缩），内部 block truncate span 到边界出省略号。
3. StatusColumn 外层 `inline-flex` → `flex`、备注 `max-w-[160px]` → `max-w-full`——同型隐患：状态列 width 130，固定 160px 上限的备注可越过自身单元格。
放弃方案：仅给标题列配 antd column.ellipsis——只裁单行文本，破坏标题+ql_id 两行结构；仅删 420 上限不换 fixed——auto 布局下 nowrap 内容 min-content 仍会撑爆协商。

文件变更清单（自声明，收口对账面）：
- frontend/src/components/changes/quicklog-table.tsx（task-01/02/03 三处）
- frontend/src/components/changes/__tests__/quicklog-table.test.tsx（task-04 回归锁定扩展）
- .sillyspec/changes/2026-09-28-quicklog-title-overflow/*（变更产物）

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-quicklog-title-overflow 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无对外接口/端点/类型变化。QuicklogTable 内部：DataTable 新增 tableLayout="fixed" 透传（antd Table 标准属性）、两处 className 变更。可见行为变化：长标题/状态备注在单元格边界截断出省略号，不再压过相邻列；列宽分布从内容协商改为定宽+剩余归标题列。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-quicklog-title-overflow 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯展示层表格布局属性，无输入/事件时序。
2. 并发写：不适用——无共享可变状态。
3. 切换/生命周期：不适用——纯渲染，无会话/请求态。
4. 作用域：tableLayout 仅加在 QuicklogTable 自己的 DataTable 调用上，不改共享 DataTable 封装（其余 13 个消费方不受影响）；多工作区同一组件同语义。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-quicklog-title-overflow 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：fixed 布局下各定宽列（130/90/130/150/190/130）被严格执行，极窄视口下宽度不够的列内容改为溢出裁切而非撑宽表格——移动端另有独立页面（m/workspaces），本表仅桌面消费，风险面可控；jsdom 无法测表格布局，几何断言由部署后生产全单元格扫描承担（成功标准第 4 条）。
另注：三断点①②按会话自主模式跳过等待（用户报障式请求、根因有生产实测锚定、改动面三行），③归档结果照常汇报。
