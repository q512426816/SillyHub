---
id: task-01
title: 后端 permissions.py 新增 LLM_PROVIDER_READ 枚举 + 权限测试
title_zh: 后端新增供应商菜单权限枚举及测试
author: qinyi
created_at: 2026-07-30 09:06:13
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/auth/permissions.py
  - backend/tests/modules/auth/test_permissions.py
goal: >
  在 Permission 枚举追加 LLM_PROVIDER_READ（字符串 llm_provider:read），供前端「我的供应商」菜单显隐与角色管理分配使用；seed_platform_admin_role 启动时幂等同步枚举至 platform_admin 角色，不写 migration。
implementation:
  - 在 permissions.py 的 Platform 子菜单权限区追加 LLM_PROVIDER_READ 枚举成员，附注释说明仅用于前端菜单显隐与角色分配、不改接口鉴权
  - 核对 group 属性默认归入 PLATFORM 组（前缀 llm_provider 无特判分支，落默认 PLATFORM），无需改 group 逻辑
  - 更新 test_permissions.py 计数断言（64 改为 65），补注释说明本变更来源
  - 新增测试断言枚举成员存在且值等于 llm_provider:read，并断言其 group 为 PermissionGroup.PLATFORM
acceptance:
  - Permission.LLM_PROVIDER_READ 存在且字符串值为 llm_provider:read
  - 该权限 group 归属 PermissionGroup.PLATFORM
  - 枚举总数断言更新为 65 且测试通过
  - 不新增 migration、不修改任何 router 鉴权
verify:
  - backend/.venv/Scripts/python.exe -m pytest backend/tests/modules/auth/test_permissions.py -v（在 backend 目录下运行）
  - backend/.venv/Scripts/python.exe -m pytest backend/tests/modules/auth/test_seed.py -v（确认 seed 同步测试零回归）
constraints:
  - 纯增量：不得改动或删除现有枚举值，不得改 group 属性既有分支
  - 权限字符串必须与前端 menu-permissions.ts 约定的 llm_provider:read 完全一致
  - 不在 seed 中给 platform_admin 之外的角色默认赋权，保持分配语义
---
