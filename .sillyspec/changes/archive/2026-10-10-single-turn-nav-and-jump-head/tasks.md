---
author: flow-machine-draft
created_at: 2026-10-10T09:06:23.767Z
---
# 任务注册表（Tasks）— 2026-10-10-single-turn-nav-and-jump-head

- [x] task-01: turn-nav-list.tsx MIN_ENTRIES 3→1（注释同步），验证：turn-nav-list.test.tsx 新增「1 条渲染/可点击」「0 条不渲染」两用例绿
- [x] task-02: turn-catalog.tsx 隐藏阈值 3→1 同口径（注释同步），验证：turn-catalog.test.tsx 隐藏用例改写为「0 条隐藏/1 条起出现」后全绿
- [x] task-03: session-panel-page.tsx 新增 handleJumpToHead（interval 轮询连续翻页到头/50 页上限 + 清锚定位顶部 + suppress/锁/复位），验证：session-history-scroll.test.tsx 新增「点击回到会话开头：连续 before 翻页到头并定位顶部」用例绿
- [x] task-04: page-helpers.tsx renderHistoryAndLocalReport 增「回到会话开头」入口（hasEarlier/jumpHeadLoading/onJumpToHead props）并接线，验证：「loading 态与到头后入口消失」用例绿
- [x] task-05: 跑三份测试文件全量（session-history-scroll / turn-nav-list / turn-catalog）+ 相关既有回归（session-panel-history-race 等）确认零回归
