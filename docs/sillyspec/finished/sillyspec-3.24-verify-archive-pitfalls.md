---
author: qinyi
created_at: 2026-07-23 02:05:36
---

# SillySpec 3.24 verify/archive 实测与归档坑（含绕过方案 + 工具修复）

变更 `2026-07-22-task-execute-attachments` 归档过程中踩到。坑1 配置绕过、坑2 环境变量已就位、坑3 工具已修复。

## 坑1（已绕过）：verify 实测 module subset 要求 local.yaml `modules:` 块，不是 `module_paths:`

**现象**：`verify --done` 的 product validation（runVerifyTestCheck，verify-postcheck.js L257）按 `test_strategy:module` 决定全量还是模块子集。但 `extractModules`（L80-114）找的是顶层 `^modules:` 块（inline flow mapping，含 `path` + `test` 两个键）。项目 local.yaml 用的是旧字段 `module_paths:`（只有 path，没 test，且 key 名不同）→ `extractModules` 返回 null → **fallback 跑全量 `commands.test`**（backend+frontend+daemon 全量）。

**后果**：全量 backend pytest ~12min，且 main 分支 backend 全量有 33 个预存 errors（非 ppm 模块，与本变更无关），导致 verify 实测必然 failed/timeout。

**绕过（已落实）**：local.yaml 加 `modules:` 块（inline flow），用**子模块粒度**（ppm/frontend/daemon 各自独立 test），不用 backend 大模块全量。这样 verify 实测按 git diff 命中模块跑（ppm 变更只跑 ppm 399 + 命中的 frontend），精确到变更范围，避开 main 预存 errors。

```yaml
modules:
  ppm: { path: "backend/app/modules/ppm/", test: "cd backend && uv run pytest app/modules/ppm -q --no-cov" }
  frontend: { path: "frontend/", test: "cd frontend && pnpm test" }
  sillyhub-daemon: { path: "sillyhub-daemon/", test: "cd sillyhub-daemon && pnpm test" }
```

## 坑2（已解，local.yaml 注释过时）：SILLYSPEC_TEST_TIMEOUT_MS 环境变量

local.yaml 旧注释「坑2 未解：backend 全量 pytest ~12min > gate TEST_TIMEOUT_MS 10min，待 sillyspec 改进」**已过时**。sillyspec 3.24 的 verify-postcheck.js L23：`const TEST_TIMEOUT_MS = Number(process.env.SILLYSPEC_TEST_TIMEOUT_MS) || 10*60*1000` —— 已支持环境变量配置。全量测试场景设 `SILLYSPEC_TEST_TIMEOUT_MS=1500000` 即可。（local.yaml 注释已更新。）

## 坑3（已修，工具已修复）：archive step5 --change 找不到已归档变更

**原现象**：archive step4 `--confirm` 把变更目录从 `changes/<name>/` 移到 `changes/archive/<date>-<name>/`。紧接着 step5（「更新路线图和提交」）`--done --change <name>` 时，主命令前置校验 `validateChangeExists`（run.js:1596 → stage-contract.js）发现 `changes/<name>/` 已移走 → `process.exit(1)` 报「变更在当前 spec 下不存在」，step5 失败。

**关键澄清（原描述曾误判分裂）**：此问题**不会**导致 db/文件系统分裂。step5 `--change` 失败是前置校验 exit(1)（在 pm.read 之前），到不了 completeStep，不触发 rollbackStageCompletion。归档实质（文件移动 + `unregisterChange` 标 `status=archived`）在 step4 --confirm 已完成（run.js:2286 移动 + 2293 unregister）。run.js:3439 的 rollback 是 **verify 实测失败**触发的，与 archive step5 无关。

**曾用绕过**：step5 `--done` 不带 `--change`（validateChangeExists 对空 changeName 放行，用 db currentChange）。

**工具修复（已落地）**：`stage-contract.js` 的 `validateChangeExists` 对 archive 阶段加特例——`changes/<name>/` 不存在时检查 `changes/archive/<date>-<name>/`（精确匹配 `YYYY-MM-DD-<changeName>`，避免后缀子串误匹配，如 auth ≠ deep-auth），存在则放行。step5 现在带 `--change` 也能正常完成。回归测试 `test/change-exists-validation.test.mjs`（3 个新用例）。

## 附：main 分支 backend 全量 33 预存 errors（待排查，独立技术债）

纯净工作区（只本变更 ppm）跑 `pytest app/modules --ignore=app/modules/ppm`：1701 passed, **33 errors**，含 `app/modules/task/tests/test_router.py::test_task_board_contains_workspace_ids` 等。这些在非 ppm 模块（本变更没碰），是 main 既有技术债，建议单独排查（不属于某个 ppm 变更）。在此之前，verify 实测必须用 module subset（子模块粒度）规避全量。
