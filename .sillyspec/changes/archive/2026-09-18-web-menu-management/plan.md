---
plan_level: full
author: WhaleFall
created_at: 2026-09-18 14:50:00
---

# 实现计划（Plan）

## Spike 前置验证

无 Spike——全部技术方案在仓库内有既有先例（枚举扩展 / SQLModel 表 + 迁移 / 子路由挂载 / gen:types / 纯函数合并），无未验证集成点。

## Wave 1（并行，无依赖——后端基础）
- task-01
- task-02

## Wave 2（依赖 Wave 1——后端数据层）
- task-03
- task-04

## Wave 3（依赖 Wave 2——后端接口层）
- task-05

## Wave 4（依赖 Wave 3——后端测试 + 类型生成，并行）
- task-06
- task-07

## Wave 5（依赖 Wave 4——前端基础，并行）
- task-08
- task-09

## Wave 6（依赖 Wave 5——前端装配，并行）
- task-10
- task-11

## Wave 7（依赖 Wave 6——前端测试）
- task-12

## Wave 8（依赖 Wave 7——文档收口）
- task-13

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Permission 枚举 +5 与 group 前缀映射 | W1 | P0 | — | FR-01, D-001@v1 | skill/mcp/agent_profile/agent_session→AGENT、menu→PLATFORM 默认 |
| task-02 | MenuOverride 表模型 + schema | W1 | P0 | — | FR-02/FR-05, D-002@v1 | admin/model.py + schema.py；无 role 维度 |
| task-03 | 迁移：建表 + 种子授全角色 | W2 | P0 | task-01, task-02 | FR-01 | 4 新 key × 全部现存 roles 行，保现状（R-07 例外记录） |
| task-04 | menu_overrides_service | W2 | P0 | task-01, task-02 | FR-02/FR-05 | list/upsert/delete + 审计 + label 1–30 / sort 0–999 校验 |
| task-05 | 子路由三端点 + main.py 挂载 | W3 | P0 | task-04 | FR-02/FR-05 | GET 认证 / PUT/DELETE menu:admin（审查 B-01：不入 admin 主 router） |
| task-06 | 后端测试 | W4 | P0 | task-03, task-04, task-05 | FR-01/02/05 | CRUD/403/422/审计/孤儿容忍/种子断言 |
| task-07 | pnpm gen:types 重跑 | W4 | P0 | task-01, task-05 | FR-04 | openapi.json + api-types.ts（枚举 +5、端点类型） |
| task-08 | menu-permissions.ts 注册表更新 | W5 | P0 | task-07 | FR-01/FR-04, D-001@v1 | 4 菜单补 permissions 去 pickerHidden、menus 菜单项、key 类型收紧 |
| task-09 | lib/menu-overrides.ts 合并层 | W5 | P0 | task-07 | FR-05 | useMenuOverrides（失败空覆盖直通）+ mergeMenus（含 menus 豁免 R-03） |
| task-10 | app-shell 合并接入 | W6 | P0 | task-08, task-09 | FR-01/FR-05 | 渲染经 mergeMenus + 图标映射补 /admin/menus |
| task-11 | /admin/menus 管理页 | W6 | P0 | task-07, task-08, task-09 | FR-02/FR-03, D-003@v1 | 对照原型；行级即时保存；role:read 降级（R-08） |
| task-12 | 前端测试 | W7 | P1 | task-10, task-11 | FR-01/02/03/05 | merge 纯函数单测 + 页面交互 + permission.test 与 menu-permissions.test 断言同步（plan 审查实测四类断言确定性失效） |
| task-13 | 文档与部署说明 | W8 | P2 | task-12 | NFR | 模块文档增量 + 权限缓存 TTL 部署注记（R-02） |

## 关键路径

task-01 → task-02（W1 并行汇合）→ task-04 → task-05 → task-07 → task-09 → task-10 → task-12 → task-13（枚举/模型 → 服务 → 路由 → 类型生成 → 合并层 → 导航接入 → 前端测试 → 文档，最长依赖链）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 菜单目录/菜单-权限映射/新增菜单条目一律保留在 `frontend/src/lib/menu-permissions.ts` 代码内；后端仅存差异覆盖（label/sort/hidden）；不得引入后端全量菜单表或前端启动拉取菜单目录的机制（D-001 normalized_requirement）
- menu_overrides 表不得含 role/user 维度字段；改名/排序/隐藏对全部用户一致生效（含平台管理员，menus 自锁豁免除外）；按角色差异仅由权限体系承担（D-002 normalized_requirement）
- 菜单管理页权限区为只读组件；不提供任何修改权限的交互；持有角色数据来源限定为既有 GET /api/admin/roles 客户端反查，不新增后端聚合端点（D-003 normalized_requirement）
- menuKey="menus" 前端合并层恒显豁免（防自锁 R-03）；不改既有 menuKey（R-01）
- label_override 长度 1–30 字符、sort_order 0–999；PUT/DELETE require menu:admin 且写审计日志；GET /api/menu-overrides 仅需认证
- 空覆盖 = 现状行为（menu_overrides 为空时 mergeMenus 直通，导航渲染与现状逐项一致）
- UI 和文档默认使用中文，必要专业术语除外；代码实现必须兼容 Windows、Linux 和 macOS
- 前端接口类型必须从后端 OpenAPI 生成（pnpm gen:types），禁止手写；后端 schema 改动同变更内提交 api-types.ts + backend/openapi.json
- 禁止跑全量测试，仅跑自己修改相关的测试，全量测试留给 CI

## 全局验收标准

1. 相关单测全绿：backend `tests/modules/admin/test_menu_overrides.py`、frontend `menu-overrides.test.ts` + `admin/menus/__tests__/page.test.tsx` + `permission.test.ts` 同步；scoped ruff/mypy 0；`tsc` 0
2. 集成冒烟（路由/导航装配敏感）：迁移后未配置覆盖时 4 菜单可见性与迁移前一致；PUT 改名/隐藏后导航（侧边栏）渲染随之变化、menus 入口不可被隐藏
3. （brownfield）未配置新功能时行为不变：空表时导航渲染、既有 permission.test/app-shell 语义不变

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-08, task-09 | 全局验收 1/3（注册表单一数据源不动、仅增覆盖表） |
| D-002@v1 | task-02, task-04, task-11 | 全局验收 2（覆盖无 role 维度、全局生效冒烟） |
| D-003@v1 | task-11 | 全局验收 1（管理页只读权限区 + roles 反查测试） |
