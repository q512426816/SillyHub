---
author: flow-machine-draft
created_at: 2026-10-19T03:18:18.889Z
---
# 任务注册表（Tasks）— 2026-10-19-change-list-created-sort

- [x] task-01: 后端 _resolve_order_by 白名单新增 created_at_desc/created_at_asc 两键（防注入白名单映射同款）；API 缺省 fallback 保持 updated_at_desc 不变（契约零变化，前端显式传新键）
- [x] task-02: 前端列表默认排序改 created_at_desc（URL 无 sort 参数时），列头文案「更新时间」改「创建时间」，点击切换 created_at 降/升序；旧深链 sort=updated_at_* 仍兼容解析；buildChangesQuery 默认省略值同步改 created_at_desc
- [x] task-03: 聚焦测试：后端 created_at 排序用例 + 前端默认值/列头切换/buildChangesQuery 契约用例全绿；tsc 通过
