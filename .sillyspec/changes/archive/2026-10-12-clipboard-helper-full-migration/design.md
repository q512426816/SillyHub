---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-clipboard-helper-full-migration

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

clipboard-fallback 只接入了三页凭据复制，但全仓仍有 15 个文件约 20 处 `navigator.clipboard` 直调（会话 ID/群聊 ID/change 名/命令卡/审计命令/日志行/工具输出/知识条目/copy-button 复制原语等），在纯 HTTP 局域网主部署形态下同样不可用或静默失败。修法：全部调用点机械迁移到既有 `copyTextToClipboard` 单一实现——①简单 await 换 helper；②阻塞守卫（`if (!navigator.clipboard) return`，scope-audit-command-card / change-stage-actions 两处）删除，使非安全上下文从静默 no-op 升级为实际复制；③copy-button 的显式抛错分支删除（helper 失败抛错经既有 .catch(fail) 进同一 failed 状态机）；④fire-and-forget 链（void …?.writeText().then().catch()，agent-log-card/turn-segment-views/turn-timeline/session-panel×3/group-chat-panel）仅替换调用源，回调体逐字保留。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 组件层可观察变化一处：非安全上下文下各复制功能从「不可用/静默失败」变为「实际复制成功」（缺陷修复，无消费方依赖旧失败行为）；安全上下文行为零变化（helper 委托同一 API）。无 schema/端点变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用：全部为用户点击触发的单次调用；fire-and-forget 链的 then/catch 时序语义与迁移前一致（同一 Promise 链形态）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：helper 无共享状态（降级路径临时节点调用局部）；组件既有 copyingId/copied 互斥状态机零变化。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   helper finally 清理临时节点与选区，中断不残留 DOM；组件状态机（setTimeout 复位等）零变化。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不适用：纯客户端单值写入；明文/命令仅进剪贴板与即取即删的临时节点，与既有安全语义一致。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：机械迁移面大（15 文件）——以 grep 验收残留清零 + 全部触碰组件既有测试全绿 + tsc/eslint 门兜底；改动形态单一（换调用源），无逻辑重写。
- 放弃方案 A：只迁移「重要」调用点（命令卡/ID）留其余——半迁移态更不一致，且每处都同样机械，全量一次收口。
- 放弃方案 B：各组件就地复制降级逻辑——违背单一实现（helper 头注即为此而设），后续维护面翻倍。

## 回归复审加固（F1/F4/F6/F9/F10，并入本变更）

回归复审（剪贴板专项）五条缺口并入：①iOS Safari 降级（readonly+select() 缺陷 → clipboard.js 规避法：iOS 形态 contentEditable+Range 选区+setSelectionRange）；②runtimes 两处裸 await 补 try/catch setNotice（失败可见，helper JSDoc 承诺随之成立）；③copy-daemon-command 测试「明文绝不进 DOM」过期注释同步（安全上下文不进 DOM/降级路径即取即删临时节点——安全实质低：毫秒级窗口、value 为 JS 属性不进 HTML 序列化、服务端本存可恢复明文）；④api-keys 页测试 afterEach 补 defineProperty 桩清理（防潜伏假绿）；⑤lib 测试补 HTMLTextAreaElement.prototype.select 原型 spy 断言（防删 select() 仍绿）。排除面披露：降级路径目标是桌面 Chrome/Edge/Firefox + iOS（规避法后）；旧版 Safari/Android 低端 WebView 无承诺。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx | 直调换 helper |
| 改 | frontend/src/components/api-key-create-dialog.tsx | 直调换 helper |
| 改 | frontend/src/components/mcp-token-create-dialog.tsx | 直调换 helper |
| 改 | frontend/src/components/agent-log/tool-renderers.tsx | .then 链换 helper |
| 改 | frontend/src/components/changes/scope-audit-command-card.tsx | 移除阻塞守卫 + 换 helper |
| 改 | frontend/src/components/changes/detail/change-stage-actions.tsx | 移除守卫半条件 + 换 helper |
| 改 | frontend/src/components/daemon/bash-progress-card.tsx | 直调换 helper |
| 改 | frontend/src/components/daemon/copy-button.tsx | 删显式抛错分支换 helper + 头注同步 |
| 改 | frontend/src/components/daemon/agent-log-card.tsx | fire-and-forget 换 helper |
| 改 | frontend/src/components/daemon/turn-segment-views.tsx | 同上 |
| 改 | frontend/src/components/daemon/turn-timeline.tsx | 同上 |
| 改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 3 处链式换 helper |
| 改 | frontend/src/components/group-chat/group-chat-panel.tsx | 链式换 helper |
| 改 | frontend/src/components/knowledge/governance-cards.tsx | 直调换 helper |
| 改 | frontend/src/components/knowledge/entry-card-list.tsx | 直调换 helper + 注释同步 |
