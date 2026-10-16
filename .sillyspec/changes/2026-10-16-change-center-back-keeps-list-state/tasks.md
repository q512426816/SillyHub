---
author: flow-machine-draft
created_at: 2026-10-16T13:17:35.194Z
---
# 任务注册表（Tasks）— 2026-10-16-change-center-back-keeps-list-state

- [x] task-01: 列表页tab/页码/搜索/阶段/分类/聚焦/排序/pageSize同步写进URL(原生history.replaceState,不新增历史条目),刷新与从详情返回后状态保持
- [x] task-02: 详情页breadcrumb「变更列表」与错误态「← 变更列表」入口:浏览器历史可后退时router.back()回带query的列表URL,列表从URL恢复tab与页码
- [x] task-03: 无历史可退(新标签深链详情)时返回入口保持原Link跳默认列表
- [x] task-04: 列表页既有测试零回归,新增URL初始化与写回断言;详情页新增返回行为断言
