---
author: qinyi
created_at: 2026-09-16 21:14:20
---
# 任务清单（Tasks）

- [x] task-01: 桌面列表页 export 三个格式化 helper（formatTokensCompact/formatCount/formatDurationZh，不改逻辑）(depends_on: 无)
- [x] task-02: MobileChangeCard 信息增强——活动徽标 ChangeActivityBadge + 元信息行（负责人三态/影响组件）+ 执行用量行（UsageExecCell 移动化，两档判空）(depends_on: task-01)
- [x] task-03: 移动列表页重新扫描——工具栏按钮 + stats/warnings 反馈 + 失效 ["changes", wid] 前缀(depends_on: 无)
- [x] task-04: 移动列表页排序切换（筛选抽屉 chips）+ ?tab=/?search= URL 参数初始化(depends_on: 无)
- [x] task-05: 移动列表页 quicklog 筛选抽屉（状态 4 态/作者聚合/空壳占位开关，query key 真值化）(depends_on: 无)
- [x] task-06: MobileChangeDetail 三卡挂载（ChangeLastSignal/ChangeUsageCard/ScopeAuditCommandCard）+ 阶段联动（StageStepper 可点 + focusStage + 清除 chip）(depends_on: 无)
- [x] task-07: 移动详情页 ⋯ 菜单删除入口（canDeleteChange 门控 + DeleteChangeConfirm + 成功回列表）(depends_on: 无)
- [x] task-08: 测试补齐——列表页/卡片/详情页三组用例 + query key 同构断言(depends_on: task-02, task-03, task-04, task-05, task-06, task-07)
