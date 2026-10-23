---
author: flow-machine-draft
created_at: 2026-10-23T03:49:04.072Z
---
# 设计记录（Design Record）— 2026-10-23-diff-copy-p3-cleanup

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：三处小清偿，全部在 turn-file-diff-dialog.tsx 与其测试。①复制按钮由 `text={diffRowsToText(section.rows)}` 改 `getText={() => diffRowsToText(section.rows!)}`——CopyButton 的 getText 路径本就为「渲染期惰性、点击期取值」设计（注释明确「组件不在渲染期调用以保持惰性」），反之用 text 会在每次渲染（含流式/字体状态等任何重渲染）对全部 rows 做字符串拼接。②补丁区底部脚注（原「内容来自本轮 agent 日志…仅计入行数统计」）追加边界说明：复制文本为行级内容、不含 hunk 头、不可直接用于 git apply——把上一变更 design 声称而未落地的文案补上。③无补丁用例改为 `findByText` 等待说明文案（NO_PATCH 文案片段）出现后再断言无按钮，删除态同理（已等「本轮被删除」，保留）；loading 态不再作为 ready 判据。

不改 diffRowsToText 实现（纯函数正确性已由 5 个用例钉住）；不改 CopyButton 共享组件；不动归档件（FR-02 措辞矛盾属上一变更归档文档，不回改历史，教训记入本变更 requirement 语境）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- TurnFileDiffDialog：复制按钮改 getText 惰性取值（无 props 变化，复制内容不变）；补丁区脚注文案增补（纯文案）。
- 无函数签名、端点、DTO、store、路由变化；diffRowsToText 不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。惰性取值在点击时对当前段 rows 求值——点击的是渲染中该段按钮，闭包捕获的就是渲染时的 rows；section 数组只由下拉日志整体替换（非流式追加），无段内容与按钮错配的窗口。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：无并发写面。getText 纯读；剪贴板写入与上一变更一致（CopyButton 既有 1.2s 反馈复位）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。按钮随段卸载，CopyButton 卸载清定时器（既有）；target 切换时整段重渲染，getText 闭包随新 rows 重建。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。getText 只读本段 rows（来自本弹窗 path 的 collectTurnFilePatches 结果），无跨会话来源。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是脚注文案过长挤压 85vh 弹窗的可视区——缓解：脚注保持 10.5px muted 两行内文案，追加在半句后而非独立段；若仍拥挤可后移为 tooltip（本变更不做，避免过度设计）。

试过放弃的方案：① 给 diffRowsToText 加缓存（Map by rows 引用）——rows 每段唯一且弹窗生命周期短，缓存无收益还增加清理面，放弃；② 改 CopyButton 共享组件加 builtin getText 优化——其 getText 已存在，无需改；③ 回改上一变更归档的 requirements 修正 FR-02 措辞——归档件冻结（审计真相），不回改历史文档，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx | getText 惰性取值 + 脚注边界说明 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx | 脚注断言 + 说明态等待修正 |
