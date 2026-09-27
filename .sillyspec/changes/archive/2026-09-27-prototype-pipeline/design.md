---
author: flow-machine-draft
created_at: 2026-09-27T01:09:37.052Z
---
# 设计记录（Design Record）— 2026-09-27-prototype-pipeline

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-prototype-pipeline 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
把本会话已验证的「原型即实现」试点固化为常设管线：视图源码迁入 `frontend/src/components/prototype/`（页面类五视图 tsx，import 生产 primer 组件与 themes.ts token，fixture 数据）；编译器收编为 `frontend/scripts/prototype-build.mjs`（tsc 编译视图子图 → react-dom/server 静态渲染 → Tailwind 按项目配置一次编译 → 逐视图内联为单文件 HTML，附三主题切换与轻交互 vanilla JS），`pnpm prototype:build` 一键触发，产物落 `frontend/prototype-dist/` 入仓对账（重编译 diff 必须为空——原型不可能与源码分家的机械保证）。
流程描述类原型（无对应页面）走同一条管线：新增 FlowDiagram 原语（节点/边 JSON 源 → BFS 分层 → SVG 绝对定位渲染，颜色全 CSS var token，零新增依赖），配一个真实流程示例视图（SillySpec 变更流程状态机）。原型分型规约（页面类/流程类/规则类）落 `.sillyspec/docs/SillyHub/scan/PROTOTYPE.md`。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-prototype-pipeline 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外新增：① 开发命令 `pnpm prototype:build`（package.json scripts 增一行）；② 原语导出 `FlowDiagram`/`FlowDiagramProps`/`FlowNode`/`FlowEdge`（`frontend/src/components/prototype/flow-diagram.tsx`，仅原型管线消费）。无 API/端点/DTO/路由/文件格式变更；既有业务页面与组件零改动；`.gitignore` 增 `.build` 中间目录忽略。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-prototype-pipeline 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯静态编译管线（源码→产物），无运行时输入序列。
2. 并发写：产物为确定性输出（同源码同字节），并行会话同跑 build 写 `prototype-dist/` 内容幂等，冲突面为零；`.build` 中间目录会话私有且 gitignore，不提交。
3. 切换/生命周期：编译中断只残留 `.build` 中间物（可整删重建），产物仅在渲染+CSS 编译全部成功后原子写出；无状态残留。
4. 作用域：原型视图只读消费生产组件（import 单向），不反向影响业务；多仓/多实例不涉及（工具链仅本仓 frontend）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-prototype-pipeline 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：Tailwind 全量 CSS 使每产物 ~150KB、七文件合计 ~1MB 入仓——接受（纯文本 git 增量压缩后很小；后续可加按视图 content 裁剪优化，非本变更范围）。次风险：视图静态渲染无水合，交互仅 vanilla JS 子集（主题切换/tab 过滤）——规约中明示，需要完整交互的原型走 dev 预览路由（后续变更）。
试过放弃：① mermaid 文本方案——渲染产物需浏览器运行时（内联 mermaid.js ~2MB/文件）或引入 puppeteer 重依赖，放弃；② 复用 @xyflow/react——交互式定位编辑超流程「描述类」原型所需，静态渲染下自动布局不稳定，放弃。
