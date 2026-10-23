---
author: flow-machine-draft
created_at: 2026-10-23T02:34:59.849Z
---
# 设计记录（Design Record）— 2026-10-23-file-card-agent-grouping

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：纯前端展示层改造，零后端/daemon/取数改动。数据面已有区分度：ChangedFile.source 即归因（tool = 本轮 Edit/Write 补丁命中，shell = git 快照归因的其他改动——含命令行/并行会话/其他进程），无需新字段。改动集中在 file-changes-card.tsx（分组渲染 + 双段头部 + 「命令行/其他」按钮行 + 删除行可点）与 turn-file-diff-dialog.tsx（无补丁说明文案如实化 + 删除文件说明态 + 副标题条件化）；turn-timeline 接线零改动（onOpenFile 闭包已按行上抛 source/status，删除行放开即可直达弹窗）。

分组口径选 source 而非 attribution 的原因：toChangedFile 已把 edit_patch→tool / 其余→shell 收敛为两值，卡片层无须再探快照原始字段。标题双段的行级合计沿用现行为口径（各段对成员行 adds/dels 直接求和；untracked/binary 行 0/0 计入计数、贡献 0 行级——与现头部合计同源，不在本变更改口径）。删除行放开可点后，弹窗对「无补丁」的说明按 status=deleted 出删除专用文案，其余 shell 行出新如实文案（不再断言唯一原因）；「来自 agent 编辑日志」副标题仅在 sections>0 时渲染。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- 修改 FileChangesCard（frontend/src/components/daemon/file-changes/file-changes-card.tsx）：
  - 折叠头改为双段标题（本轮AGENT 段 + 总共段）；「N 个文件变更」单段旧文案由双段取代（纯展示面，data-testid 保留）；
  - 展开区：tool 行为主列表恒渲染；新增「命令行/其他」按钮行（data-testid=file-changes-other-toggle，aria-expanded），点击展开/收起 shell 行区段（data-testid=file-changes-other-list）；
  - 文件行 clickable 判定移除 status=deleted 例外（deleted 行也可点，保留 line-through）；onOpenFile 回调签名不变。
- 修改 TurnFileDiffDialog（turn-file-diff-dialog.tsx）：
  - 无补丁说明文案替换为如实表述（新增 DELETED_NO_PATCH_TEXT 删除专用说明；原 SHELL/NO_PATCH 文案合并为无断言版本）；
  - 副标题「本轮文件变更内容（来自 agent 编辑日志）」改为条件渲染：sections>0 时显示原语义，否则只显示「本轮文件变更内容」。
- 无端点、无 DTO、无 store、无路由变化；turn-timeline.tsx / session-panel 挂载面零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。分组是渲染期纯派生（files 数组 filter），不引入状态；快照对象由 props 注入（上游 attachRunFileChanges 幂等投影），流式 delta 下引用稳定守卫不回归。弹窗取数竞态沿用上一变更的 AbortController 守卫，本变更不触碰。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：无新写面。「命令行/其他」展开态是组件内 useState（每卡独立实例）；多卡并存互不影响；弹窗只读日志。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。展开态随卡片实例（折叠收起时整卡条件渲染卸载即重置——既有语义）；会话切换 key 重挂（既有纪律）弹窗与展开态一并销毁。其他区段展开态在流式重渲染下不重置（同组件实例 state 保持）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。分组只吃本卡 props.files；弹窗归属沿用 sessionId+runKey 双闸门（上一变更已审）；proto 页/agent-replay-body 等旧消费方不传 onOpenFile，删除行放开可点后其 openFile 为空操作（data-clickable 变 true 属展示语义变化，无行为）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是「本轮AGENT 0 个但 shell 很多」的形态——用户会先点开卡只看到空列表 + 按钮行，可能困惑；缓解：agent=0 时头部第一段显示「本轮AGENT 无直接文件编辑」（不渲染 +0 −0 假零），按钮行置顶显眼。次要风险：双段标题在一行 28px 内拥挤（长数字/窄面板），处理：两段间分隔符 + min-w-0 截断，两端 shrink-0。

试过放弃的方案：① daemon 侧给快照加「并行会话」独立归因（把 shell 再拆 command/parallel）——需要 mtime/进程级证据，daemon 现有采集拿不到可靠信号，放弃；② 前端按路径启发式猜并行会话（如 .sillyspec/ 前缀）——路径黑名单是伪归因，误伤用户业务文件，放弃；③ 两张独立卡片（agent 卡 + 其他卡）——把一个快照拆两张卡破坏「一轮一卡」的既有形态与测试锚，用户要的是卡内分组不是拆卡，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/file-changes/file-changes-card.tsx | 双段标题 + 分组渲染 + 其他变更按钮行 + 删除行可点 |
| 修改 | frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx | 无补丁如实文案 + 删除说明态 + 副标题条件化 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx | 双段/分组/删除可点用例 + 既有用例文案适配 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx | 新文案/删除说明用例 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 弹窗接线删除 source 透传（文案统一后 prop 无消费，死链路清理） |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | 删除行接线用例 + 双段标题断言适配 |
