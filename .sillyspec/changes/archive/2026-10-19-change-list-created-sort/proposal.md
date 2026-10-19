---
author: flow-machine-draft
created_at: 2026-10-19T03:18:18.889Z
---
# 提案书（Proposal）— 2026-10-19-change-list-created-sort

## 动机

任务原话转写：变更中心列表默认按创建时间倒序

动机：用户需求原话「变更中心 列表数据 按创建时间排序吧 越新的越靠前」——现状默认按更新时间（最近活动）排序，用户想要按创建时间看最新变更。

成功标准：
- 后端 _resolve_order_by 白名单新增 created_at_desc/created_at_asc 两键（防注入白名单映射同款）；API 缺省 fallback 保持 updated_at_desc 不变（契约零变化，前端显式传新键）
- 前端列表默认排序改 created_at_desc（URL 无 sort 参数时），列头文案「更新时间」改「创建时间」，点击切换 created_at 降/升序；旧深链 sort=updated_at_* 仍兼容解析；buildChangesQuery 默认省略值同步改 created_at_desc
- 聚焦测试：后端 created_at 排序用例 + 前端默认值/列头切换/buildChangesQuery 契约用例全绿；tsc 通过

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 后端 _resolve_order_by 白名单新增 created_at_desc/created_at_asc 两键（防注入白名单映射同款）；API 缺省 fallback 保持 updated_at_desc 不变（契约零变化，前端显式传新键）
2. 前端列表默认排序改 created_at_desc（URL 无 sort 参数时），列头文案「更新时间」改「创建时间」，点击切换 created_at 降/升序；旧深链 sort=updated_at_* 仍兼容解析；buildChangesQuery 默认省略值同步改 created_at_desc
3. 聚焦测试：后端 created_at 排序用例 + 前端默认值/列头切换/buildChangesQuery 契约用例全绿；tsc 通过

## 成功标准（可验证）

1. 后端 _resolve_order_by 白名单新增 created_at_desc/created_at_asc 两键（防注入白名单映射同款）；API 缺省 fallback 保持 updated_at_desc 不变（契约零变化，前端显式传新键）
2. 前端列表默认排序改 created_at_desc（URL 无 sort 参数时），列头文案「更新时间」改「创建时间」，点击切换 created_at 降/升序；旧深链 sort=updated_at_* 仍兼容解析；buildChangesQuery 默认省略值同步改 created_at_desc
3. 聚焦测试：后端 created_at 排序用例 + 前端默认值/列头切换/buildChangesQuery 契约用例全绿；tsc 通过
