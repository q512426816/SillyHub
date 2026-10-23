---
author: flow-machine-draft
created_at: 2026-10-23T01:22:36.798Z
---
# 任务注册表（Tasks）— 2026-10-22-askuser-dock-inputbar

- [x] task-01: 新建 PendingDialogDock 组件（自 turn-timeline 迁移最小化 state/胶囊/pill 还原 effect）；page 与 dialog 两挂载点输入区互斥渲染 dock↔SessionInputBar（互斥条件与 dock 门控同源：page 用 timelineSessionStatus 单源变量、dialog 用 view.status）；TurnTimeline 删除 pending 卡双分支渲染——验证：pending-dialog-dock.test「默认展开」7P
- [x] task-02: dock 卡列区 max-h-[45vh] overflow-y-auto overscroll-contain，外层对齐输入栏（shrink-0 bg-card px-5 pb-4 pt-1）；pendingRequests 清空后挂载点条件翻转恢复 SessionInputBar（受控 state 在父级不丢）——验证：dock 测试「容器固定最大高度」断言 +「父级移除卡→dock 整体消失」用例
- [x] task-03: 最小化/胶囊/还原逻辑原样迁移；focusRequest effect 去滚顶保「还原+ring 闪烁 1.2s」——验证：dock 测试「最小化」「还原保留已填内容」「多卡累计」「focusRequest 触发还原+闪烁」
- [x] task-04: ended/failed 门控随迁（dock return null），挂载点互斥条件同源排除——验证：dock 测试「ended 会话：dock 整体不渲染」
- [x] task-05: TurnTimeline 删 pendingRequests/onDialogResolved/focusDialogRequest 三 props（sessionStatus 保留不解构）；agent-replay-body 与 13 个测试文件清理过期传参；minimize 测试迁移为 pending-dialog-dock.test.tsx（旧文件删除）；群聊零改动——验证：受影响套件 325P（dock 7+input-bar 22+inplace 6+批量 8 文件 75+dialog 63+provider-caps 22+marker-card 18+pre-session 36+群聊 12+config-bar 64）+ tsc 零错（并行 marquee 在途错误除外）+ eslint 零告警
