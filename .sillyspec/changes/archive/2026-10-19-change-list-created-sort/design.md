---
author: flow-machine-draft
created_at: 2026-10-19T03:30:00.000Z
---
# 设计记录（Design Record）— 2026-10-19-change-list-created-sort

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户需求原话「变更中心 列表数据 按创建时间排序吧 越新的越靠前」。两处：后端
`_resolve_order_by` 白名单新增 `created_at_desc/created_at_asc` 两键（白名单映射
防注入同款）；前端列表默认排序改 `created_at_desc`（显式传参），列头文案
「更新时间」→「创建时间」，点击在 created_at 降/升序间切换。

API 缺省 fallback 保持 `updated_at_desc` 不变——契约零变化（其他消费方如
change-autolink 不受影响），默认切换仅发生在前端列表页。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /changes` sort 参数白名单扩展：`created_at_desc` / `created_at_asc`；
  缺省/未知值行为不变（fallback updated_at_desc）。
- `SortDir` 前端类型扩四值；新增 `parseSortDir`（白名单解析，非法回默认）；
  `SORT_DIR_DEFAULT = "created_at_desc"`；`buildChangesQuery` 默认省略值同步改
  （旧深链 `sort=updated_at_*` 仍解析兼容）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：排序是每请求无状态 order_by，无中间态。
2. 并发写：纯读路径；created_at 建行后不变，排序稳定。
3. 切换/生命周期：URL sort 参数白名单解析非法回默认；旧深链兼容。
4. 作用域：order_by 作用在本 workspace 分页查询内，无跨域。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险：默认排序变化改变用户既有习惯（最近活动 → 创建时间）——正是用户主动要求，
非回归。created_at 与 updated_at 在 reparse 回填 mtime 时的差异：created_at 是
建行时刻（CLI 创建顺序），语义即用户诉求。放弃方案：改后端缺省值——会波及全部
不传 sort 的调用方（change-autolink 等），契约面无谓扩大。
