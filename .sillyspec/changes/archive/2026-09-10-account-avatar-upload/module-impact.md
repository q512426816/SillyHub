---
author: qinyi
created_at: 2026-09-10 20:50:00
---

# 模块影响分析（Module Impact）— 个人中心头像替换

> 影响类型：逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增；以 worktree 真实 diff 为准（真实 > 记录）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend:auth | backend/app/modules/auth/model.py | 数据结构变更（User.avatar 列 String512 nullable） | 否 |
| backend:auth | backend/migrations/versions/20260910160000_users_avatar.py | 数据结构变更（alembic 加列，可逆） | 否 |
| backend:auth | backend/app/modules/auth/schema.py | 接口变更（UserRead.avatar + UpdateMyAvatarRequest DTO） | 否 |
| backend:auth | backend/app/modules/auth/router.py | 接口变更（PATCH /api/auth/me/avatar 端点） | 否 |
| backend:auth | backend/app/modules/auth/service.py | 逻辑变更（update_my_avatar 三态分派） | 否 |
| backend:daemon-group | backend/app/modules/daemon/group/service/helpers.py | 逻辑变更（回落纯函数 + 批量预取映射） | 否 |
| backend:daemon-group | backend/app/modules/daemon/group/service/members.py | 逻辑变更（加/改成员返回回落） | 否 |
| backend:daemon-group | backend/app/modules/daemon/group/service/crud.py | 调用关系变更（6 个 _to_read 调用点接预取） | 否 |
| backend:daemon-group | backend/app/modules/daemon/group/service/__init__.py | 调用关系变更（_to_read 门面签名透传可选映射） | 否 |
| backend:auth-test | backend/tests/modules/auth/test_my_avatar.py | 新增（端点四态 7 用例） | 否 |
| backend:daemon-test | backend/tests/modules/daemon/test_group_member_avatar_fallback.py | 新增（回落矩阵 16 用例） | 否 |
| backend:openapi | backend/openapi.json | 配置变更（gen:types 再生成，含新端点） | 否 |
| frontend:stores | frontend/src/stores/session.ts | 数据结构变更（SessionUser.avatar 可选字段） | 否 |
| frontend:lib | frontend/src/lib/auth.ts | 接口变更（updateMyAvatar + fetchMe 映射补字段） | 否 |
| frontend:lib | frontend/src/lib/api-types.ts | 配置变更（gen:types 再生成） | 否 |
| frontend:components | frontend/src/components/group-chat/group-member-avatar.tsx | 接口变更（ownerType 可选 prop + USER_AVATAR_OWNER_TYPE） | 否 |
| frontend:app | frontend/src/app/(dashboard)/account/page.tsx | 新增（桌面个人资料卡片） | 否 |
| frontend:app-test | frontend/src/app/(dashboard)/account/page.test.tsx | 新增（4 用例 + 既有收窄 selector） | 否 |
| frontend:app | frontend/src/app/m/account/page.tsx | 新增（移动头像上传整块可点） | 否 |
| frontend:app-test | frontend/src/app/m/account/page.test.tsx | 新增（5 用例） | 否 |
| frontend:components | frontend/src/components/app-shell.tsx | 调用关系变更（TopBar 传 avatar） | 否 |
| frontend:components | frontend/src/components/top-bar.tsx | 接口变更（avatar prop + AvatarImage blob 渲染） | 否 |
| frontend:components-test | frontend/src/components/__tests__/top-bar-avatar.test.tsx | 新增（4 用例） | 否 |
| frontend:components | frontend/src/components/daemon/turn-timeline.tsx | 逻辑变更（sender.me 气泡头像接线） | 否 |

## 未匹配文件

无——全部 diff 文件已按语义归属上表（migrations/tests 目录在 module-map paths 外属历史游离惯例，按语义模块标注）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| 模块索引 | 无需 rebuild：migrations/tests 为历史游离路径惯例，语义归属已在上表判明 | skipped（有据） |
