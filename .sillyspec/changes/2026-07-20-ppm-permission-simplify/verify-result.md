---
author: qinyi
created_at: 2026-07-20 13:57:05
---

# 验证报告（Verify Result）— 精简 PPM 权限

变更：`2026-07-20-ppm-permission-simplify`
结论：**PASS WITH NOTES**（integrcritical 类 AC-3 PG 部署 apply + AC-4 真实 e2e 留部署期验证）

## 1. 任务完成情况

| Task | Wave | 内容 | 状态 |
|---|---|---|---|
| task-01 | W1 | 6 ppm router 改 `get_current_principal` 仅认证 | ✅ |
| task-02 | W1 | 迁移双轨（改旧 seed 25→8 + 新清理迁移 DELETE 17 条） | ✅ |
| task-03 | W1 | 前端 project-members 菜单删悬空 `ppm:project:write` | ✅ |
| task-04 | W2 | 删 17 个 PPM_* 操作权限枚举成员 + 更新 test_ppm_permissions | ✅ |
| task-05 | W2 | 新增 ppm 接口冒烟测试（登录 200 / 未登录 401） | ✅ |
| task-06 | W3 | picker 适配确认（零代码改动，读 menu-permissions）+ api-types 评估 | ✅ |

**3 个非计划内连带（集成测试发现，task allowed_paths 未覆盖，统一在主仓库收口）**：

1. `backend/tests/modules/admin/test_roles_router.py` 删除 `test_update_role_accepts_ppm_problem_export`（引用已删 `Permission.PPM_PROBLEM_EXPORT`，该测试是为被删权限"合法性"存在的 regression，权限删后失去前提）。
2. `backend/tests/modules/auth/test_permissions.py` `test_permission_count_is_70` → `test_permission_count_is_53`（总枚举数 70→53，断言 + 函数名 + docstring 同步）。
3. `frontend/src/lib/__tests__/menu-permissions.test.ts` mirror 常量删 16 个动作权限条目（70→54）、长度断言、project-members 断言改 read-only。

## 2. 验收标准对照（AC-1 ~ AC-8）

| AC | 内容 | 结果 | 证据 |
|---|---|---|---|
| AC-1 | Permission PPM_* 成员 25→8 | ✅ | `len(list(Permission))==53`（45 历史 + 8 PPM 菜单）；test_ppm_permissions 14 passed；test_permissions 34 passed |
| AC-2 | 6 router 无 `require_permission_any` | ✅ | `grep require_permission_any(Permission\.PPM_ backend/app` 零命中 |
| AC-3 | role_permissions 17 条清零 | ✅(逻辑) | 迁移 `20260720_drop_ppm_op` revision 链 down=`20260720_problem_status_3state`，alembic 单头；`DELETE WHERE permission IN (17)` 逻辑正确。**PG 部署 apply 后 `SELECT count(*)==0` 待部署期验证** |
| AC-4 | ppm 接口登录 200 / 未登录 401 | ✅ | `test_router_smoke.py` 2 passed（`/api/ppm/workbench/profile` 登录 200 / 未登录 401） |
| AC-5 | project-members 菜单对持有 read 的用户可见 | ✅ | menu-permissions.ts L362 仅 `ppm:project:read`；menu-permissions.test.ts 29 passed |
| AC-6 | admin picker 不列被删的 17 个权限 | ✅ | picker 数据源=menu-permissions.ts（task-03 已清 project-members write）；枚举本身已删 17 成员 |
| AC-7 | backend lint + frontend typecheck | ✅ | `ruff check .` All passed；`ruff format --check .` 665 files OK；`mypy app/modules/auth app/modules/ppm` 84 files no issues；`pnpm typecheck` 通过 |
| AC-8 | test_ppm_permissions + 冒烟测试全绿 | ✅ | test_ppm_permissions 14 + test_router_smoke 2 + test_roles_router 13 全 passed |

## 3. 测试与质量扫描

### backend pytest（auth + admin + ppm 三目录）
- **171 passed, 2 failed, 5 xfailed**（198s）
- 2 failed 拆解：
  - `test_permission_count_is_70` → **已修**为 `_is_53`，复跑 34 passed（属本变更连带）。
  - `test_auth_user_read_email_optional` → **预存测试债，非本次引入**：`UserRead.model_validate` 报 `employee_no Field required`，`employee_no` 字段由 commit `6180c548 feat(ppm): PPM 工作台聚合子域 + users 加 employee_no` 引入，该测试 SimpleNamespace 未跟上补字段。`git diff --stat HEAD -- app/modules/auth/schema.py` 为空（本变更未动 schema）。不在本变更范围。

### backend lint
- `uv run ruff check .` → All checks passed
- `uv run ruff format --check .` → 665 files already formatted
- `uv run mypy app/modules/auth app/modules/ppm` → 84 source files, no issues

### frontend
- `pnpm typecheck`（tsc --noEmit）→ 通过
- `vitest run src/lib/__tests__/menu-permissions.test.ts` → 29 passed

### 迁移链
- `alembic heads` → 单头 `20260720_drop_ppm_op`
- `20260720_problem_status_3state.py` 存在，revision 匹配新迁移 down_revision

### app.main 加载
- `from app.main import app` → OK，124 个 `/api/ppm/` 路由注册成功（6 router 经 main.py 挂载正常；裸 `python -c "from app.modules.ppm.plan import router"` 的循环 import 是 baseline 既有 import 顺序假象，非本次引入）

## 4. 风险登记回顾（design §10）

| 编号 | 风险 | 处置 |
|---|---|---|
| R-01 | ppm 接口安全语义降级 | 用户已知情同意（仅 platform_admin 曾有权限 + 普通用户看不到菜单 + 按钮靠 is_platform_admin/所有权） |
| R-02 | 新迁移 down_revision 接错致多 head | ✅ execute 前 `alembic heads` 确认单头，down_revision 接 `20260720_problem_status_3state` |
| R-03 | api-types 重生成引入无关 diff | ✅ 核对后**跳过** api-types.ts 重生成：daemon diff 2307 行仅 2 行 ppm（99.9% 累积漂移），frontend 762 行仅 2 行 ppm；picker 读 menu-permissions.ts 不受影响。保留 openapi.json 重生成（53 行 26 行 ppm，符合每提交重生成约定） |
| R-04 | ppm 模块无 router 测试 | ✅ task-05 补 test_router_smoke.py（登录 200 / 未登录 401） |
| R-05 | picker 数据源 | ✅ task-06 确认读 menu-permissions.ts，task-03 已清，零代码改动 |
| R-06 | 旧种子迁移改清单 CI 影响 | ✅ 改 upgrade 内容，已 stamp 环境不重跑；新清理迁移负责数据清理 |

## 5. 已知遗留 / NOTES

1. **AC-3 PG 部署验证**：清理迁移 `DELETE 17 条` 的 SQLite 单测覆盖不到（测试走 create_all 非迁移），生产 PG `alembic upgrade head` 后 `SELECT COUNT(*) FROM role_permissions WHERE permission IN (17)` 应 == 0，留部署期核实。
2. **AC-4 真实 e2e**：冒烟测试用 TestClient 覆盖 200/401，真实 daemon/部署链路 e2e 留部署期。
3. **api-types.ts 陈旧**（按 R-03 主动跳过）：frontend/daemon 两份 api-types.ts 仍含被删的 17 个权限字符串（派生产物，不影响功能，picker 不读它）。下次统一重生成时会被修正。
4. **`backend/scripts/migrate_from_ruoyi.py` L234-285**：ruoyi→ppm 权限映射表仍指向被删权限（如 `pm:project-maintenance:create → ppm:project:write`）。该脚本是**一次性已执行 ETL**（2026-06-20 ruoyi 数据迁移，archive 文档证实），非运行时流程；被 `resync_*.py` import 的只是 `is_deleted`/`src_query`/`uuid5_int` 工具函数非权限映射。重跑会插入孤儿 role_permissions，由新清理迁移兜底删除。超出本变更范围，不动。
5. **预存测试债 `test_auth_user_read_email_optional`**：commit 6180c548 引入，建议后续 quick 修（SimpleNamespace 补 `employee_no` 字段）。
6. **方案 A 彻底删除**：枚举 / 迁移 / role_permissions / 测试四处全清，无死代码残留（`grep PPM_(PROJECT|CUSTOMER|PLAN|PROBLEM|TASK)_(WRITE|DELETE|EXPORT)|PPM_WORKHOUR_WRITE|PPM_KANBAN_ASSIGN backend/app` 零命中）。

## 6. 自检

- ✅ 需求覆盖：用户两点决策（保留菜单开关 + 完全去接口校验）+ 方案 A 彻底删除，全部落地。
- ✅ 文档一致：design / decisions / plan / 6 TaskCard 与最终实现一致。
- ✅ 无回归：auth+admin+ppm 171 passed（除 1 预存 email 债 + 已修 count 测试）。
- ✅ 风险闭环：R-01~R-06 全部处置或说明。
