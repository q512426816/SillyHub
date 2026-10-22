---
author: flow-machine-draft
created_at: 2026-10-22T04:04:55.020Z
---
# 任务注册表（Tasks）— 2026-10-22-askuser-card-inline

- [x] task-01: turn-timeline.tsx pending 卡容器类名 `sticky top-0 z-10 + indigo 背景条` → `mb-3 space-y-2` 内嵌文档流；ref stickyCardsRef→inlineCardsRef；容器注释与 session-panel-page.tsx 定位注释同步——验证：minimize 套件「默认展开」新增非 sticky 断言
- [x] task-02: 最小化占位与胶囊零改动验证（visiblePendingCount===0 时 className undefined 保留）——验证：minimize 套件「最小化：卡片消失、胶囊出现角标 1、容器视觉框移除」
- [x] task-03: 待决策 pill 定位还原不回退（effect 仅 ref 更名，滚顶+ring 闪烁逻辑零变化）——验证：minimize 套件「还原保留已填内容」+ session-panel-dialog 套件
- [x] task-04: 受影响测试全绿 + tsc 零错——实测：minimize 6P + dialog-inplace/session-input-bar 29P + session-panel-dialog 63P，`tsc --noEmit` 零输出
