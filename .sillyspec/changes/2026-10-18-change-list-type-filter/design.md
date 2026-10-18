---
author: flow-machine-draft
created_at: 2026-10-18T13:39:27.068Z
---
# 设计记录（Design Record）— 2026-10-18-change-list-type-filter

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

类型通道（2026-10-18-change-type-git-conventional）已让详情页显示 git 惯用前缀类型，
但列表页无类型信息也无筛选。本变更三处：① CommitTypeChip 从详情侧栏抽为公共组件
`components/changes/commit-type-chip.tsx`（两处同源，口径恒一致）；② 列表行 meta 行
change_key 后渲染类型标签（无类型旧行零占位）；③ 后端 `list_` / `GET /changes` 新增
`change_type` 筛选参数 + 前端筛选栏「类型」下拉（URL 参数 `type`，与出身分类正交组合）。

筛选口径与显示层一致：feat 等价命中旧值 feature（显示映射 feature→feat 的逆口径，
存量行不漏筛）；白名单（conventional 前缀 + feature/prototype/quick 旧值）外不过滤，
对齐 lineage/sort 的 fallback 风格。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/workspaces/{ws}/changes` 新增可选 query 参数 `change_type`（前端
  `listChanges` 参数名 `changeType`）；白名单内值 → SQL `change_type IN (...)`
  （feat 展开 `("feat","feature")`）；白名单外/缺省 → 不过滤。既有参数全部不变。
- `ChangeService.list_` 新增关键字参数 `change_type: str | None = None`；类常量
  `_CHANGE_TYPE_FILTER_WHITELIST` / `_CHANGE_TYPE_FILTER_ALIASES`。
- `buildChangesQuery` 签名新增 `typeFilter: string`（URL 参数名 `type`，空值省略
  ——默认 URL 干净契约不变）；导出函数是返回链接契约，调用方（详情页返回测试）
  需同步补字段。
- 新公共组件 `CommitTypeChip`（`frontend/src/components/changes/commit-type-chip.tsx`）：
  props `{ type: string }`，data-testid=commit-type-chip，样式/映射随组件走。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：筛选是每请求无状态 SQL where，URL 参数解析对非法值回退默认
   （TYPE_OPTIONS 白名单校验），迟到/乱序不构成中间态。
2. 并发写：纯读路径（GET + useQuery），与既有筛选同链路，无新共享状态。
3. 切换/生命周期：tab 切换/重置随既有筛选一并回默认；URL 写回沿用原生
   replaceState 快照（不新增历史条目）；chip 是纯展示组件无副作用。
4. 作用域：筛选 where 绑定 workspace_id（既有 base），跨工作区不串台；feat 别名
   展开在 SQL 层完成，两工作区同值同语义。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：筛选值集与展示映射漂移（feat↔feature 口径在后端 aliases、前端
COMMIT_TYPE_DISPLAY 两处维护）。缓解：两端各有测试钉（后端 feat 等价命中用例 /
前端 feature→feat 显示用例），且值集注释互指对方为权威。残余面：TYPE_OPTIONS 未
列 ci/revert/quick（防下拉过长），后端白名单仍可筛——深链手输 URL 可用，下拉不可
选，属有意取舍。

试过放弃：A. 类型筛选复用 lineage 的「全局集合→SQL IN」两阶段——类型是列值非
   投影字段，直接 where 即可，无需两阶段；B. 前端本地过滤——total/分页会错
   （pending_review_only gap② 前车之鉴），必须服务端筛。
