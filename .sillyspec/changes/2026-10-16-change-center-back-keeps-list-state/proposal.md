---
author: flow-machine-draft
created_at: 2026-10-16T13:17:35.193Z
---
# 提案书（Proposal）— 2026-10-16-change-center-back-keeps-list-state

## 动机

任务原话转写：动机:变更中心列表切「已归档」tab或翻页后点行进详情,点详情页「变更列表」返回入口回到列表会重置为进行中tab第1页——列表tab/页码全是组件useState不进URL,返回是客户端导航导致列表组件重挂载。
成功标准:
- 列表页tab/页码/搜索/阶段/分类/聚焦/排序/pageSize同步写进URL(原生history.replaceState,不新增历史条目),刷新与从详情返回后状态保持
- 详情页breadcrumb「变更列表」与错误态「← 变更列表」入口:浏览器历史可后退时router.back()回带query的列表URL,列表从URL恢复tab与页码
- 无历史可退(新标签深链详情)时返回入口保持原Link跳默认列表
- 列表页既有测试零回归,新增URL初始化与写回断言;详情页新增返回行为断言

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 列表页tab/页码/搜索/阶段/分类/聚焦/排序/pageSize同步写进URL(原生history.replaceState,不新增历史条目),刷新与从详情返回后状态保持
2. 详情页breadcrumb「变更列表」与错误态「← 变更列表」入口:浏览器历史可后退时router.back()回带query的列表URL,列表从URL恢复tab与页码
3. 无历史可退(新标签深链详情)时返回入口保持原Link跳默认列表
4. 列表页既有测试零回归,新增URL初始化与写回断言;详情页新增返回行为断言

## 成功标准（可验证）

1. 列表页tab/页码/搜索/阶段/分类/聚焦/排序/pageSize同步写进URL(原生history.replaceState,不新增历史条目),刷新与从详情返回后状态保持
2. 详情页breadcrumb「变更列表」与错误态「← 变更列表」入口:浏览器历史可后退时router.back()回带query的列表URL,列表从URL恢复tab与页码
3. 无历史可退(新标签深链详情)时返回入口保持原Link跳默认列表
4. 列表页既有测试零回归,新增URL初始化与写回断言;详情页新增返回行为断言
