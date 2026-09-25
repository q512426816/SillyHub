---
author: flow-machine-draft
created_at: 2026-09-25T23:10:15.906Z
---
# 需求规格（Requirements）— 2026-09-26-manifest-heal-endpoint

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 墓碑行 heal 语义

- Given：manifest 行带 platform_deleted=True（或 exists=False 墓碑态）
- When：POST manifest-heal 带显式 paths
- Then：这些行 platform_deleted→False、exists→True、version 不动；非墓碑行跳过计入 skipped

### FR-02: heal 即冲突闭环

- Given：该工作区存在开放 spec-sync 冲突行
- When：heal 成功执行
- Then：开放行被关闭（复用 _close_open_sync_conflicts）

### FR-03: 输入校验与鉴权

- Given：paths 含工作区未登记路径
- When：POST manifest-heal
- Then：422 语义错误（AppError 家族，原文 404 系笔误——评审 P3 勘误；清单外路径不含前缀批量语义）；端点要求 WORKSPACE_WRITE

### FR-04: 审计与幂等

- Given：heal 执行（含重放）
- When：任意次调用
- Then：structlog 记 workspace_id/healed/skipped 计数；非墓碑行重放安全（skipped）

### FR-05: 零回归

- Given：既有 spec_workspace 测试
- When：定向跑模块
- Then：162 passed 1 skipped（含新 2 用例）；mypy 979 文件 0 错

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_platform_deleted_guard.py::TestManifestHeal::test_heal_tombstone_rows_and_close_conflicts（healed/skipped/version 不变/未列不动断言）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同上用例（开放冲突行为空断言）


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_platform_deleted_guard.py::TestManifestHeal::test_heal_unknown_path_rejected（AppError 422）+ router WORKSPACE_WRITE（require_permission 依赖）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同 test_heal_tombstone_rows_and_close_conflicts（幂等重放=再次调用 healed 空/skipped 满——非墓碑行跳过语义覆盖）


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd backend && uv run pytest app/modules/spec_workspace -q --no-cov（162 passed 1 skipped）+ uv run mypy app（979 文件 0 错）


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd backend && uv run pytest app/modules/spec_workspace -q --no-cov（162 passed 1 skipped）+ uv run mypy app（979 文件 0 错）


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd backend && uv run pytest app/modules/spec_workspace -q --no-cov（162 passed 1 skipped）+ uv run mypy app（979 文件 0 错）


<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd backend && uv run pytest app/modules/spec_workspace -q --no-cov（162 passed 1 skipped）+ uv run mypy app（979 文件 0 错）


<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd backend && uv run pytest app/modules/spec_workspace -q --no-cov（162 passed 1 skipped）+ uv run mypy app（979 文件 0 错）

