---
author: qinyi
created_at: 2026-10-14 10:12:00
---

# 模块影响分析（Module Impact）— 2026-10-14-deploy-release-notes

> CLI 自动生成降级失败的手写兜底版（gate 报缺失）。影响类型列由 execute/verify 按实际 diff 回填。

## 模块影响矩阵

| 模块 | 涉及文件 | 影响类型 | 说明 |
|---|---|---|---|
| backend | backend/app/modules/auth/permissions.py、backend/migrations/versions/20261014110000_add_deploy_record_read_permission.py、backend/app/modules/deploy_records/**（NEW）、backend/app/main.py、backend/pyproject.toml、backend/tests/modules/auth/test_permissions.py、backend/tests/test_align_platform_change_events_migration.py、backend/openapi.json | 行为新增 | deploy_record:read 枚举+AGENT 组归类；workspace_owner 种子迁移；deploy_records 只读模块（零表）；main.py 注册；pyyaml 显式化；len 锚 58→59+迁移 replay 测试×4+链尾锚前移；openapi 契约再生成 | 新增 deploy_record:read 权限与种子迁移；新建只读模块 deploy_records；main.py 注册路由；pyyaml 显式化 |
| frontend | frontend/src/lib/deploy-records.ts（NEW）、frontend/src/lib/query-keys.ts、frontend/src/app/(dashboard)/deploy-records/**（NEW）、frontend/src/lib/menu-permissions.ts、frontend/src/components/app-shell.tsx、frontend/src/lib/api-types.ts、frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx、frontend/src/lib/__tests__/menu-permissions.test.ts | 行为新增+断言面平移 | /deploy-records 页（primer 左列表右详情+MarkdownText）；queryKeys 工厂追加；菜单注册 governance 组第 4 条（History 图标）；api-types 再生成；注册表长度 36→37/镜像 59/声明序锚 system 组 +1 | 新页面/数据层/菜单注册；gen:types 再生成；断言面⑦锚重算 |
| docs | .zcode/skills/sillyhub-docker-deploy/SKILL.md | 文档更新 | 「发布记录（每次部署必做）」硬步骤节：锚点查询/git log/规整总结/md 模板/失败也记录/本地回退（主仓文件，gitignore 面无 commit） | skill 增「发布记录」硬步骤节 |

## 未匹配文件

| 文件 | 原因 | 处置 |
|---|---|---|
| docs/releases/*.md（未来运行时产物） | 尚不存在，运行时由 agent 生成 | 无需模块登记 |

## 更新结果

| 文档 | 状态 | 说明 |
|---|---|---|
| modules/backend.md | done | backend entrypoints 补 deploy_records_router；卡片契约摘要随归档留档 |
| modules/frontend.md | done | /deploy-records 页与菜单注册属页面级新增，卡片无契约级变化 |
| _module-map.yaml | done | backend entrypoints 已补 deploy_records_router 行 |
