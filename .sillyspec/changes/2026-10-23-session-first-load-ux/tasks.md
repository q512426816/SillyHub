---
author: flow-machine-draft
created_at: 2026-10-23T06:45:37.494Z
---
# 任务注册表（Tasks）— 2026-10-23-session-first-load-ux

- [x] task-01: TurnTimeline 新增可选 historyLoading prop + 轮次骨架屏分支（turns 空且 loading 真时渲染 3 张卡形骨架，替代静态空态）——验证：turn-timeline-history-loading.test.tsx 新用例绿
- [x] task-02: 提炼补拉增量合并纯函数（输入底窗行集与 adaptive 结果 → prepend 轮块数组 + 新游标；log id 差集去重、空补拉/整体回退返回空）——验证：纯函数单测四种形态绿
- [x] task-03: session-panel-page establish 两段化（底窗先渲染 + initialHistoryLoading state + 补拉完成增量 prepend + historyLoadingRef 挂起翻页 + catch/finally 复位加载态）+ TurnTimeline 传 prop——验证：session-first-load-staged.test.tsx 新用例绿
- [x] task-04: 空会话终态不误显骨架（establish 尾部置 false 覆盖成功/失败路径）——验证：空会话用例保持原空态文案
- [ ] task-05: 回归护栏——跑 session-panel/turn-timeline/initial-window 相关既有测试 + lint 全绿，补 visual-evidence.md 对照说明
