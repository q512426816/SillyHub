---
author: flow-machine-draft
created_at: 2026-10-23T03:31:55.136Z
---
# 设计记录（Design Record）— 2026-10-23-diff-dialog-copy-fallback

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：两处小改。① turn-file-diff.ts 新增纯映射 `diffRowsToText(rows: DiffRow[]): string`——按行类型重建 unified 前缀文本（del→`-`、add→`+`、ctx→空格），剔除 parseStructuredPatch 插入的 hunk 分隔伪行（type=ctx 且 oldNo/newNo 均 null，text 为「…」），其余 ctx 行原样；rows 是完整数据（DiffView 的 2000 行截断只是渲染层 slice），复制天然不受限。② turn-file-diff-dialog.tsx 每段补丁标题行（「第 N 次 · 工具名」）右侧挂常显复制按钮——复用 daemon/copy-button 的 CopyButton（语义 token 配色、copyTextToClipboard 降级链），经 className 覆盖默认 hover 浮出定位（`static ml-auto opacity-100`，twMerge 后者胜）为常显；无补丁/删除/加载/失败态不渲染该段标题行，复制入口自然不存在。

选 daemon/copy-button 而非 agent-log/tool-renderers 版：前者用语义 token（text-muted-foreground / hover:bg-muted / brand done 态）符合本项目语义色规范，后者是 zinc 硬编码老组件。复制文本不预置文件头/hunk 头（平台不持有 diff 元数据，伪 header 会误导 git apply），纯行文本供阅读与粘贴。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- 新增 `diffRowsToText(rows: readonly DiffRow[]): string`（turn-file-diff.ts，纯函数，导出供测试与复用）。
- TurnFileDiffDialog 补丁段标题行新增复制按钮（data-testid=turn-file-diff-copy，aria-label「复制该段 diff」）；无 props 变化。
- 无端点、无 DTO、无 store、无路由变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。复制是用户点击时对当前已渲染 rows 的同步纯函数调用，不依赖请求时序；弹窗取数竞态守卫不变。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：无并发写面。复制只读 rows + 写系统剪贴板；同一按钮连点由 CopyButton 内部 1.2s 反馈窗口兜住（既有实现）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。复制按钮随段卸载即消失，CopyButton 卸载清理定时器（既有实现）；弹窗切换 target 时 rows 整体替换，无残留旧文本（复制只读当前渲染）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。复制内容只来自本弹窗当前 path 的补丁段 rows；剪贴板是浏览器级作用域，不涉及平台数据归属。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是复制文本与 DiffView 视觉行的对齐预期——用户可能期望复制的内容可直接 `git apply`，但平台没有 hunk header（`@@ -a,b +c,d @@`）与文件头，纯前缀文本不能直接应用。缓解：按钮 label 与段标题明确语义（「复制该段 diff」），脚注保持「仅行级内容」表述；不伪造 header 是刻意选择。

试过放弃的方案：① 直接复制原始 edit_patch JSON——粘贴出去不可读且与脚注「完整内容」语义不符，放弃；② 给 diffRowsToText 拼造 unified header（用 rows 行号推 @ 头）——hunk 边界信息已丢（分隔伪行是视觉标记），拼造可能错位误导 git apply，放弃；③ 升级 DiffView 为内置复制（改共享组件签名）——DiffView 现有 5+ 消费方（agent-log 工具卡、daemon tool-args-detail）都有自己的复制兜底，改共享件会牵动面过大，本变更在弹窗消费侧挂按钮即可，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/file-changes/turn-file-diff.ts | 新增 diffRowsToText 纯映射 |
| 修改 | frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx | 每段标题行挂常显复制按钮 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts | diffRowsToText 用例 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx | 复制按钮/超长完整性/无按钮态用例 |
