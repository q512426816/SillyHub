---
author: flow-machine-draft
created_at: 2026-10-19T05:48:31.294Z
---
# 设计记录（Design Record）— 2026-10-19-preview-card-empty-turn-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因：切换档案产生「纯切换轮」（backend inject.py silent_config_switch，inject.py:608）——建 run 刻意零日志（实测会话 54317e42 第 2/4/7 轮均 0 条日志、started_at 空、无 engine_anchor）。刷新后轮次大纲（agent_runs 全量投影）包含该轮，归并层把「大纲有、无实质内容」一律合成「未加载 · 点击展开」预览卡；点击后单轮直达查回 0 条日志走 empty 静默短路（session-panel-page.tsx fetchAndAttachTurn）并记入零正文幂等黑名单，卡片永久展不开且无反馈。

方案（前端两处小改）：① preview-merge.ts 新增 isContentlessTerminalItem 判定（started_at 空 + error_code 空 + 摘要双空 + previewTurnStatusOf 映射 completed/killed 终态），命中该类大纲条目不再合成预览卡——turns 有命中（孤儿配置行/已加载空壳）原引用透传并盖 seq（恢复 2026-10-14 design 非目标「静默配置切换轮紧凑配置行语义保留」），无命中不生成条目（深历史静默轮回到 preview-cards 之前的不可见语义）；② handleExpandPreview 对 empty 结果补 notify.warning 轻提示，兜底消灭「点了没反应」。判据核心是 started_at：正常轮派发引擎后必有值，纯切换轮从未派发恒空；群聊空 user_input 轮（2026-09-29 幂等语义）、失败族（失败卡是内容）、活跃族（后续可能出内容）都被 started_at/error_code/终态三条件天然排除，行为零变化。

追加（真机验收发现，同缺陷家族第三面——导航跳转链路）：③ 修复上线后真机点左侧导航的静默轮刻度弹「操作失败」——直达链路对零日志轮走 notify.error("该轮次日志不存在…")，纯字符串被 errMessage 吞成默认「操作失败」（errors.ts misuse guard），且无内容终态轮本就不该报错。修法：isContentlessTerminalItem 导出复用（单一判定源），handleJumpToTurn 命中即早退——不发请求，直接定位高亮既有配置行并记幂等；三处固定文案（直达零日志 / 回退翻页到头 / 展开失败）改 notify.warning 原文；prefetchNearbyTurns 跳过无内容邻居不再发无效请求。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

preview-merge.ts 新增模块内私有函数 isContentlessTerminalItem（不导出）；mergePreviewIntoDisplayTurns 归并循环新增一个前置分支（无内容终态条目：命中透传盖章 / 未命中跳过），导出签名与既有导出（mergePreviewIntoDisplayTurns / previewTurnStatusOf / TurnPreviewInfo）零变化。session-panel-page.tsx handleExpandPreview 内部对 "empty" 结果新增 notify.warning 调用，回调签名零变化。无端点/schema/api-types 改动（后端与 daemon 零改动，对齐 2026-10-14 D-002 边界）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。判定只消费大纲条目自身字段（started_at/error_code/摘要/status），无跨源时序假设；大纲迟到到达时（挂载后拉取完成前）归并原样透传，大纲到位后下一次派生自动收敛为透传/跳过形态——显示层自愈，无持久错乱。实时新纯切换轮（大纲尚未含它）照旧走孤儿配置行尾部追加（现状），刷新后大纲含它走透传分支，两态显示一致（配置行），本次修复同时消除了刷新前后形态漂移。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无新增写路径。归并层纯函数（WeakMap 盖章缓存按原引用幂等，同输入同引用）；notify 走 antd message 串行队列。empty 幂等标记/在飞去重集合的既有单线程访问模式不变。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。无新增状态；纯切换轮被排除出展开链路后，jumpEmptyJumpedRunIdsRef/previewInflightRef 的会话切换重置链不变；fetchAndAttachTurn 纪元/卸载守卫不动。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。判定键为单会话大纲条目，无跨会话共享状态；后端零改动，多实例数据面与现状一致。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：判定把「有内容但零摘要」的轮误收敛成不可见（例如仅 tool 通道日志的轮）。防护：started_at 有值即排除（tool-only 轮必然派发过引擎），摘要双空 + error_code 空 + started_at 空三条件同时成立才收敛；失败族/活跃族显式排除并有单测锁定。次风险：历史数据存在 started_at 缺失的正常轮（字段后补）——实测当前库正常轮 started_at 均有值；若真出现，该轮退化为不可见（无预览卡），导航刻度仍可跳转，属可接受降级。放弃方案：①后端大纲剔除纯切换轮——会导致全局轮号重排（seq 权威序），导航与轮次徽章全部错位，否决；②仅把卡片改置灰不可点——丢失配置行的档案/引擎信息且刷新前后形态仍不一致，否决；③大纲挂载后失效重拉（消除 stale outline）——治标不治本（拉到新大纲后死卡依旧），且本次透传方案已让两态一致，留作后续独立评估。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/preview-merge.ts | 新增 isContentlessTerminalItem 判定 + 归并循环前置分支（透传盖章/跳过），文件头归并规则注释同步；追加：isContentlessTerminalItem 导出（跳转/预取链路复用，单一判定源） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | handleExpandPreview 对 empty 结果补 notify.warning 轻提示；追加：handleJumpToTurn 无内容终态轮早退定位、三处固定文案 notify.error→notify.warning、prefetchNearbyTurns 跳过无内容邻居 |
| 修改 | frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts | 新增「无内容终态轮」describe 五用例；outlineItem fixture 默认补 started_at（对齐真实契约：正常轮必有值），既有断言语义不变 |
| 修改 | frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx | 新增「静默切换轮不出预览卡渲染配置行」集成用例；真零正文轮用例补轻提示断言（mock @/lib/errors useNotify）；追加导航刻度点击两用例（静默轮无 toast 无请求定位 / 真缺失日志报原文 warning） |
| 修改 | frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | 既有导航零日志兜底用例断言同步新通道：notifyError → notifyWarning 原文（FR-06 行为变更追踪，旧断言锁的是被 errMessage 吞文案的坏通道） |
| 新增 | docs/releases/2026-10-19-013-205a79f71.md | 发布记录（frontend 首次重建上线本次修复，容器内 chunk 校验） |
| 新增 | docs/releases/2026-10-19-014-5b9c2ce4c.md | 发布记录（真机验收追加修复——导航静默轮「操作失败」，frontend 二次重建） |
