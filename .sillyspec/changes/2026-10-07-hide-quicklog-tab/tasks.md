---
author: flow-machine-draft
created_at: 2026-10-07T12:25:23.852Z
---
# 任务注册表（Tasks）— 2026-10-07-hide-quicklog-tab

- [x] task-01: 桌面端 TABS 移除 quicklog 项 + UnderlineNav label/counter 特判清理（验证：tsc/组件无 quicklog 死分支，深链逻辑保持）
- [x] task-02: 移动端 TABS 移除 quicklog 项 + tab 徽标「存量 · N」特判清理（验证：tablist 仅渲染 active/archive 两 testid）
- [x] task-03: 桌面测试改造：2 个 quicklog 用例改 ?tab=quicklog 深链进入并补 tab 缺席断言（验证：vitest 该文件全绿）
- [x] task-04: 移动端测试改造：新增 renderQuicklogPage 深链辅助，12 处 tab 点击与计数徽标/URL 初始化用例重写（验证：vitest 该文件全绿）
- [ ] task-05: 仅跑两份受影响测试文件确认全绿后，按显式 pathspec 提交交付代码与 tasks.md
