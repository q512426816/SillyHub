---
author: flow-machine-draft
created_at: 2026-10-13T06:32:14.177Z
---
# 任务注册表（Tasks）— 2026-10-13-turn-nav-rail-overflow-fix

- [x] task-01: 轮次很多(内容高超过面板高)时窄轨刻度不再溢出面板,超出部分在轨内滚动(turn-nav-rail 去掉 shrink-0,nav flex-1+overflow-y-auto 真正生效)
- [x] task-02: 轨内滚动不显示滚动条(与 turn-catalog 同款 scrollbar-width:none + webkit hidden)
- [x] task-03: 少量轮次时形态不变(44px 窄轨+把手+居中刻度,浮层行为不受影响)
- [x] task-04: turn-nav-list 单测补齐布局契约断言(rail 无 shrink-0、nav 可滚动+滚动条隐藏),既有测试全绿
