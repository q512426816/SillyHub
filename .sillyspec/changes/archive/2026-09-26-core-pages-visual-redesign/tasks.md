---
author: qinyi
created_at: 2026-09-27 00:58:00
---
# 任务清单（Tasks）

- [x] task-01: themes.ts semantic soft 浅底阶扩展（三主题各配，旧单值字段保留）
- [x] task-02: primer 基础原子组件（StateIcon/StateLabel/Counter/EmptyState）+ 单测 (depends_on: task-01)
- [x] task-03: primer 结构组件（PageHead/UnderlineNav/IssueRow/StatGrid）+ 单测 (depends_on: task-01, task-02)
- [x] task-04: primer 时间线与侧栏组件（Timeline/MetaPanel）+ 桶导出 index.ts + 单测收口 (depends_on: task-02, task-03)
- [x] task-05: 变更中心列表页重排（四层结构/IssueRow 列表/flash 告警收敛）+ 测试同步 (depends_on: task-03)
- [x] task-06: 变更详情页重排（checks 横条/时间线主线/MetaPanel 右栏）+ 测试同步 (depends_on: task-04)
- [x] task-07: 工作区列表页重排（行式列表/drag-grid 行式化/规范分页/Modal 删除）+ 测试同步 (depends_on: task-03)
- [x] task-08: 工作区概览页重排（白底页头/守护横幅/统计四格/两栏/antd 表单化）+ 测试同步 (depends_on: task-03)
- [x] task-09: 会话门户左栏展示层 Primer 化 + 测试同步 (depends_on: task-02, task-03)
- [x] task-10: 会话门户中栏展示层 Primer 化（含四分支）+ 测试同步 (depends_on: task-09)
- [x] task-11: 会话门户右栏信息面板 + 测试同步 (depends_on: task-10)
- [x] task-12: top-bar token 修复 + 涉及文件硬编码色 grep 清零核对 (depends_on: task-05, task-06, task-07, task-08, task-09, task-10, task-11)
- [x] task-13: FRONTEND_PAGE_STYLE.md 回写（primer 章节 + D-304 条款改写） (depends_on: task-12)
