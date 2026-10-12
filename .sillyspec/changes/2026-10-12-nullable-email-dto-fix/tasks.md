---
author: flow-machine-draft
created_at: 2026-10-12T05:44:39.275Z
---
# 任务注册表（Tasks）— 2026-10-12-nullable-email-dto-fix

- [x] task-01: 写 admin 失败测试——test_roles_router.py 新增「email=None 用户经 user_roles/user_workspace_roles 绑定 → GET roles/{id}/users 返回 200 且 email=null、username 有值」用例，跑出 500 红（验证:pytest -k email_null 复现 ValidationError）
- [x] task-02: admin 修复——RoleUserRead.email 可空+username 字段（admin/schema.py），roles_service.list_users 两处构造补 username，task-01 用例转绿（验证:pytest tests/modules/admin/test_roles_router.py 全绿）
- [ ] task-03: workspace 修复——members_router 测试新增「email=None 成员列表 200 + 搜索命中 200」用例先红；WorkspaceMemberView/UserSearchHit email 可空+username（workspace/schema.py），members_service 列表/搜索 select 与构造补 username，members_router._row_to_view 补 username（验证:pytest tests/modules/workspace/test_members_router.py 全绿）
- [ ] task-04: 前端类型同步——frontend `pnpm gen:types`（刷新 backend/openapi.json + api-types.ts）、sillyhub-daemon `pnpm gen:types`、workspace-members.ts 手写 DTO 改 email 可空+username（验证:两个 gen:types:check 无 diff）
- [ ] task-05: 前端空值回退——roles/page.tsx 聚合 email 可空+排序 null 安全+单元格回退，workspace-member-row.tsx 回退链，workspace-member-add-dialog.tsx 候选回退，members/page.tsx 标签回退，workspace-member-row.test.tsx 补 null 用例（验证:frontend tsc --noEmit 0 错 + vitest 该测试文件绿）
- [ ] task-06: 回归与提交——重跑 backend 两个相关测试文件全绿；显式 pathspec 分批提交全部改动（提交消息带对应 task-NN）
