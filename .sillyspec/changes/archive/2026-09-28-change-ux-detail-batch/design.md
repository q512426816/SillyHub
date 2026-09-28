---
author: flow-machine-draft
created_at: 2026-09-28T09:04:42.689Z
---
# 设计记录（Design Record）— 2026-09-28-change-ux-detail-batch

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-ux-detail-batch 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯前端八点体验修正（用户实测反馈逐条对号）：①列表行描述 span 补 min-w-0——flex 项默认 min-width:auto，长文 nowrap 撑破行宽溢出覆盖右列阶段/时间与 meta 行影响模块，min-w-0 收缩后 truncate 生效；②详情页 PageHeader subtitle 追加描述行（w-full 独占 + truncate + title 悬浮）；③平台同步常驻卡收进工具条「平台同步」按钮 + antd Drawer（destroyOnHidden），组件加 drawerHint prop：未绑定数据源时抽屉内出中性提示而非空白；④ChangeStageActions thin 分支改 return null（协议长文案退役，出身拦截保留）；⑤ChangeAssetsCard 默认展开（useState(true)）+ 自 aside 移主栏 + 分组改 md:grid-cols-2 网格、每组 h-64 固定高度 flex-col + 内层 overflow-y-auto；⑥详情页移除 ChangeAgentRunLog 挂载及其 agentStatus 取数链（getAgentStatus/refreshAgentStatus/panelRunId 全退，组件保留供 mobile-change-detail）；⑦QuicklogLinkedCard 空列表/加载中/失败一律不渲染；⑧ScopeAuditCommandCard 去头部说明副标题、DegradedNotice 双段压单行（保留「不出三态」口径与归档指路）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-ux-detail-batch 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无后端/端点/schema 变更。前端契约面：PlatformSyncSectionProps 新增可选 drawerHint（默认 false 向后兼容，m/ 页用法零改动）；ChangeStageActions thin 出身返回 null（消费方仅详情页主栏首位）；ChangeAssetsCard 默认展开 + 挂载位 aside→main；QuicklogLinkedCard 空态由文案改静默隐藏；scope-audit 卡删 scope-audit-degraded-scope testid（降级口径并入 degraded-view 单行）。ChangeAgentRunLog 组件与其测试保留（移动端消费），仅桌面详情页摘挂载。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-ux-detail-batch 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：不适用——全部为展示层组件，数据到达顺序由既有 useQuery 保证，无新增时序假设。
2. 并发写：不适用——零 mutation，纯只读展示。
3. 切换/生命周期：Drawer destroyOnHidden 关闭即卸载处理区（含其内部轮询查询），无泄漏；assets 卡默认展开仅初始态，收起交互保留。
4. 作用域：不适用——无跨工作区数据；drawerHint 为 prop 级开关不影响 m/ 页既有 compact 用法。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-ux-detail-batch 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：布局类改动（grid/h-64/滚动）在真实浏览器的观感无法由 jsdom 断言——已按 tailwind 语义保守实现（md 两列、h-64 固定高、min-h-0 flex-1 overflow-y-auto 链条齐全），真机目验移交用户；列表行修复是标准 flex 陷阱修法（min-w-0），确定性高。放弃的方案：沉淀资产每组独立 max-h（行高不齐对不齐）——改统一 h-64 换取网格对齐；平台同步保留常驻但折叠——用户明确要求收进按钮，折叠态仍占一行。
