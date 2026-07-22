---
author: qinyi
created_at: 2026-07-23 02:05:36
---

# SillySpec 3.24 verify/archive 实测与归档坑（含绕过方案）

变更 `2026-07-22-task-execute-attachments` 归档过程中踩到。前两条已绕过（配置/环境变量已就位），第三条是工具未修 bug。

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

## 坑3（工具未修，活跃）：archive step5 --done --change 找不到已归档（移动后）变更

**现象**：archive 流程 step4 `--confirm` 把变更目录从 `changes/<name>/` 移到 `changes/archive/<date>-<name>/`（成功）。紧接着 step5（「更新路线图和提交」）`--done --change <name>` 时，sillyspec 用 `--change` 解析 `changes/<name>/` 路径——**已被 step4 移走**，报「变更在当前 spec 下不存在」，step5 --done 失败。

**更糟**：step5 --done 失败会触发 `rollbackStageCompletion`（run.js L3439），把整个 archive 阶段的 db 推进**回滚**（verify 从 completed 退回 in-progress、archive steps 清空），但 step4 的**文件移动无法回滚**（mv 不是事务）→ db 与文件系统**严重分裂**。

**绕过（已确认）**：
1. step5 `--done` **不带 `--change`**：sillyspec 改用 db current active change（archive 阶段的）识别变更，能逐步推进 step1→step4（重跑，幂等）。
2. **判归档完成的正确标志**：`unregisterChange`（progress.js L682）只是 `UPDATE changes SET status='archived'`（**不删 changes 表记录**）。所以 `status='archived'` 即归档完成。archive stage 的 step5 step-tracking 显示 pending 只是表面残留（sillyspec 没标 step5 completed），**不影响归档实质**——sillyspec status 看 `status=archived` 即认为完成。
3. 修分裂：若已踩分裂（db verify in-progress + 文件已 archive/），把文件 mv 回 `changes/<name>/`，重跑 `verify --done` 再走 archive。

**建议工具修复**：archive step4 移动文件后，step5 应改用 db 追踪变更身份（不依赖 `--change` 的文件路径解析）；或 step5 在 step4 移动**前**完成 git add + unregister。

## 附：main 分支 backend 全量 33 预存 errors（待排查，独立技术债）

纯净工作区（只本变更 ppm）跑 `pytest app/modules --ignore=app/modules/ppm`：1701 passed, **33 errors**，含 `app/modules/task/tests/test_router.py::test_task_board_contains_workspace_ids` 等。这些在非 ppm 模块（本变更没碰），是 main 既有技术债，建议单独排查（不属于某个 ppm 变更）。在此之前，verify 实测必须用 module subset（子模块粒度）规避全量。
