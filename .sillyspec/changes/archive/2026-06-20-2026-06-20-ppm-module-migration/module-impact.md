---
author: qinyi
created_at: 2026-06-20T15:35:00+0800
change: 2026-06-20-ppm-module-migration
---

# 模块影响分析

> 三重交叉验证:声明范围(design §6)≈ 任务范围(plan/tasks)≈ 真实变更(git status 91+ 文件)。以 git 为准。

## 影响模块矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|--------------|
| **ppm(全新)** | 新增 | backend/app/modules/ppm/**(51 文件) | 全新 ppm 模块:5 子域(project/plan/problem/task/kanban)+ common,21 表,102 路由,2 套状态机,平台级 | true(新模块,_module-map.yaml 未收录,建议下次 scan 加入) |
| auth | 接口变更 | backend/app/modules/auth/permissions.py | 新增 24 个 PPM_* 权限枚举 + PermissionGroup.PPM(46→70) | false |
| frontend_app | 新增 | frontend/src/app/(dashboard)/ppm/**(14 文件) | 13 ppm 页面 + shared.tsx | true |
| frontend_lib | 新增+逻辑 | frontend/src/lib/ppm/**(8 文件) + menu-permissions.ts | ppm API client(102 函数/73 类型)+ 菜单登记(15 ppm 项) | false |
| frontend_components | 新增 | frontend/src/components/ppm-resource-table.tsx, ppm-status-actions.tsx | 泛型 CRUD 表格 + 状态机操作组件(复用) | false |
| (基础设施) | 配置变更 | backend/app/main.py, migrations/env.py, pyproject.toml, uv.lock, conftest.py | 注册 5 ppm router(/api/ppm)+ env import + openpyxl 依赖 + 测试 model 注册 | false |

## 未匹配文件(基础设施,非业务模块)
- backend/migrations/versions/*ppm*.py(6 迁移:seed_ppm_permissions/create_ppm_task/merge/create_ppm_plan/create_ppm_project/create_ppm_problem)
- backend/tests/modules/auth/test_ppm_permissions.py(auth 测试)
- frontend/src/lib/__tests__/menu-permissions.test.ts(更新计数 46→70)

## 建议(留后续 scan)
1. 新模块 ppm 需加入 `.sillyspec/docs/SillyHub/modules/_module-map.yaml`(paths: backend/app/modules/ppm/**)
2. 生成模块文档 `ppm.md`(scan)
3. frontend_app/frontend_lib/frontend_components 模块文档更新(ppm 子目录)
