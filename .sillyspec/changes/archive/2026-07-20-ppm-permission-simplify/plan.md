---
plan_level: full
author: qinyi
created_at: 2026-07-20 12:32:27
---

# 实现计划（Plan）— 精简 PPM 权限

## Spike 前置验证

无。技术路径已在 brainstorm 调研确认（无独立 permissions 表、`get_current_principal` 现成、ppm 模块无 router 测试、迁移幂等写法已知），无技术不确定性。

## Wave 1（并行，无依赖）

- [x] task-01: 6 个 ppm router（project/plan/task/problem/kanban/workbench）端点 `Depends(require_permission_any(Permission.PPM_*))` → `Depends(get_current_principal)`（覆盖：FR-03, D-002@v1）
- [x] task-02: 数据库迁移双轨——改旧种子迁移 `202607041000` 的 `PPM_PERMISSIONS` 清单 25→8 + 新增清理迁移 `DELETE FROM role_permissions WHERE permission IN (17 个)`（覆盖：FR-04, D-003@v1）
- [x] task-03: 前端 `menu-permissions.ts` project-members 菜单删悬空 `ppm:project:write` 条目（覆盖：FR-06, D-001@v1）

## Wave 2（依赖 Wave 1）

- [x] task-04: 删 `permissions.py` 17 个 PPM_* 操作权限枚举成员 + 更新 `test_ppm_permissions.py`（EXPECTED 25→8 / count 断言 / admin 持有权限断言）（覆盖：FR-01, FR-02, FR-05, D-004@v1）依赖：task-01
- [x] task-05: 新增 ppm 接口冒烟测试 `backend/tests/modules/ppm/test_router_smoke.py`（登录 200 / 未登录 401）（覆盖：FR-08, R-04）依赖：task-01

## Wave 3（依赖 Wave 2）

- [x] task-06: `admin-role-permission-picker` 适配确认 + `sillyhub-daemon/src/api-types.ts` 重新生成（覆盖：FR-07, D-004@v1）依赖：task-04

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 6 ppm router 改 get_current_principal | W1 | P0 | — | FR-03, D-002@v1 | 去权限校验，保留 JWT+API key 双路径认证 |
| task-02 | 迁移双轨（改旧 seed 清单 + 新清理迁移） | W1 | P0 | — | FR-04, D-003@v1 | 新迁移 down_revision 接 execute 时确认的当前 head（R-02） |
| task-03 | 前端 project-members 清悬空 write | W1 | P1 | — | FR-06, D-001@v1 | menu-permissions.ts L362-365，菜单显隐不变 |
| task-04 | 删 17 枚举成员 + 更新 test_ppm_permissions | W2 | P0 | task-01 | FR-01/02/05, D-004@v1 | 枚举与测试强耦合，同 task 改 |
| task-05 | ppm 接口冒烟测试 | W2 | P1 | task-01 | FR-08, R-04 | 弥补 ppm 模块无 router 测试 |
| task-06 | picker 适配 + daemon api-types 重生成 | W3 | P1 | task-04 | FR-07, D-004@v1 | daemon 重生成核对 diff 只含 ppm 权限（R-03） |

## 关键路径

task-01 → task-04 → task-06（最长路径）。task-02 / task-03 与关键路径并行（W1）；task-05 在 W2 与 task-04 并行。

## 全局验收标准

- **AC-1** Permission PPM_* 成员 25→8，test_ppm_permissions 通过
- **AC-2** 6 router 无 require_permission_any（grep 零命中）
- **AC-3** role_permissions 17 条清零（清理迁移 upgrade 后 SELECT count == 0）
- **AC-4** ppm 接口登录 200 / 未登录 401（task-05 冒烟覆盖）
- **AC-5** project-members 菜单对持有 ppm:project:read 的用户可见
- **AC-6** admin picker 不列被删的 17 个权限
- **AC-7** backend lint（ruff + mypy）+ frontend typecheck 通过
- **AC-8** test_ppm_permissions + 冒烟测试全绿

## 自检

- ✅ checkbox 格式：所有 task 用 `- [ ] task-XX:`
- ✅ FR 覆盖：FR-01 ~ FR-08 全部映射到 task
- ✅ D 覆盖：D-001(task-03) / D-002(task-01) / D-003(task-02) / D-004(task-04, task-06) / 方案 A(task-04) 全覆盖
- ✅ 依赖无环：W1 → W2 → W3 线性，Wave 内并行
- ✅ task 粒度均匀：6 task，每 task 范围清晰、可独立验收
- ✅ 无 P0/P1 unresolved blocker（decisions 全 accepted）
- ✅ 关键路径明确（task-01 → task-04 → task-06）
