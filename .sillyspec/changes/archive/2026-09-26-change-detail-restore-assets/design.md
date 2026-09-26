---
author: flow-machine-draft
created_at: 2026-09-26T05:54:31.129Z
---
# 设计记录（Design Record）— 2026-09-26-change-detail-restore-assets

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-detail-restore-assets 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯前端恢复性修复，只动 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` 一个实现文件：①aside 末尾重新挂载 `ChangeAssetsCard`（a7eca0727 落地形态，import+注释一起恢复）；②`STATUS_BADGE` 补回 `thin: { label: "轻量变更", variant: "default" }` 并恢复 quick「快速任务（存量）」口径与四态注释（01a9dfcbd）；③`ScopeAuditCommandCard` 调用恢复 `archived={isTerminalChange(change)}` 传参与指路注释（9cb48847d，组件侧 prop 未动）。选恢复而非重写：三处原实现经 9/25 归档评审验证，且组件/后端接口全程未删，逐字节找回原挂载即可；304eba982 新增的 `ChangeObservationEventsCard` 是并行线的有效交付，保留不回退。另新增一个页面级钉子测试防再次静默丢失。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-detail-restore-assets 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无对外签名变化。后端 `GET /changes/{cid}/assets` 与组件 prop（`ScopeAuditCommandCard.archived?: boolean`）均未动；变化的只是详情页对既有组件的挂载与传参——前端可见行为恢复：aside 再现沉淀资产卡、thin/quick 标题徽章恢复品牌紫口径、已归档变更对账降级横幅再现指路。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-detail-restore-assets 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯展示层挂载恢复，无事件/输入时序；`ChangeAssetsCard` 自取数 30s/失败静默，轮询乱序由 react-query 缓存语义兜底。
2. 并发写：不适用——单文件 UI 挂载，无共享可写状态；资产卡只读消费后端聚合端点。
3. 切换/生命周期：详情页轮询对终态停轮逻辑（isTerminalChange）未动；资产卡在变更删除（404）时静默隐藏，不打断页面（a7eca0727 既有语义）。
4. 作用域：不适用——挂载在 workspace 路由下的单变更详情，`workspaceId/changeId` 全程来自路由参数，无跨工作区串台面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-detail-restore-assets 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：恢复的挂载再次被并行会话夹带覆盖（本次事故根因即此）。缓解：新增页面级钉子测试断言资产卡与观测事件卡并存，下次任何提交删挂载会被聚焦测试拦下（CI 层面）。试过但放弃：把 aside 卡片清单抽成数组配置防漏挂——放弃，卡片间挂载条件与注释各不相同（quicklog 卡需 change_key、对账卡带 archived 语义），抽象后反而丢语义，收益不成比例。线上已部署旧镜像的窗口期：需重新部署前端镜像才能让用户看到恢复，代码层无风险。
