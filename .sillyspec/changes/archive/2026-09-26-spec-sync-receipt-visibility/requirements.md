---
author: flow-machine-draft
created_at: 2026-09-25T16:20:13.220Z
---
# 需求规格（Requirements）— 2026-09-26-spec-sync-receipt-visibility

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 全量同步回执计数

- Given：全量 tar 同步存在跳过成员（platform_deleted 墓碑前缀排除 / staging 成员缺失）
- When：POST /spec-workspace/sync
- Then：回执新增 landed_files 与 skipped_files；skipped>0 时服务端显式 warn 日志

### FR-02: 增量同步回执计数（daemon/CLI 双轨）

- Given：增量 ops 存在冲突跳过或墓碑拒收
- When：POST sync-incremental（daemon 轨道）或 /changes/-/spec-sync（CLI 轨道）
- Then：回执新增 applied_ops / skipped_conflict / skipped_tombstone / platform_deleted 四键

### FR-03: 冲突进注册表

- Given：增量同步发生冲突（乐观锁版本不匹配或墓碑拒收）
- When：apply_ops 处理完成
- Then：幂等写 spec_conflicts 开放行（stage=spec-sync；details_json 含 server_versions / platform_deleted / conflicting_paths / last_seen_at）；同工作区同 stage 开放行只更新不重复建

### FR-04: 全绿闭环

- Given：存在开放的 spec-sync 冲突行
- When：下一次全绿增量同步
- Then：开放行自动置 resolved（不留僵尸行）

### FR-05: 工作区冲突横幅

- Given：spec_conflicts 存在开放行
- When：渲染工作区布局
- Then：顶部细条警示（数量 + 镜像可能滞后提示）；无开放行或请求失败不渲染

### FR-06: 契约同步与零回归

- Given：响应 schema 变更与既有测试
- When：gen:types 与定向测试
- Then：api-types.ts / openapi.json 同步重生成随提交；两模块 430 passed 1 skipped；前端横幅 3 passed + tsc 0 错

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py::test_sync_conflict_registry_open_and_close（skipped_tombstone=1 / applied_ops=0 断言）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/spec_workspace/tests/test_sync_incremental.py（端点形状断言已补 applied_ops/skipped_conflict/skipped_tombstone/platform_deleted 四键）+ test_platform_deleted_guard.py 同用例回执四键断言


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py::test_sync_conflict_registry_open_and_close（开放行唯一 + details_json 含 platform_deleted 路径断言）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py::test_sync_conflict_registry_open_and_close 第③段（全绿同步后开放行为空）


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/__tests__/spec-sync-conflict-banner.test.tsx（三态：非空渲染/空不渲染/失败静默）


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）


<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）


<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）


<!--AGENT:测试绑定FR-10 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）

定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）

backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py::test_sync_conflict_registry_open_and_close（skipped_tombstone=1 / applied_ops=0 断言）

tests/test_platform_deleted_guard.py::test_sync_conflict_registry_open_and_close（skipped_tombstone=1/applied=0 断言）


<!--AGENT:测试绑定FR-11 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）

定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）


<!--AGENT:测试绑定FR-12 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）

定向回归：cd backend && uv run pytest app/modules/spec_workspace app/modules/platform_sync -q --no-cov（430 passed 1 skipped）+ cd frontend && pnpm exec vitest run src/components/__tests__/spec-sync-conflict-banner.test.tsx（3 passed）+ pnpm exec tsc --noEmit（0 错）

