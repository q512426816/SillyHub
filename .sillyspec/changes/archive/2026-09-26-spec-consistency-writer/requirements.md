---
author: flow-machine-draft
created_at: 2026-09-26T00:02:17.793Z
---
# 需求规格（Requirements）— 2026-09-26-spec-consistency-writer

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 三向对账端点

- Given：镜像磁盘树与 manifest 行存在错位
- When：GET /spec-workspace/consistency
- Then：disk_only / manifest_ghost / tombstoned_on_disk 三类分歧 + counts 汇总（.runtime/local.yaml 排除口径与同步一致）

### FR-02: 写方记录

- Given：apply_sync 或 apply_ops 成功执行
- When：带 writer 参数
- Then：SpecWorkspace.last_writer/last_writer_at 更新（独立短事务幂等；同写方重复不警）

### FR-03: 写方切换告警

- Given：last_writer 与本次 writer 不同
- When：_note_writer
- Then：structlog warning（previous/new 写方）——双写者漂移信号

### FR-04: Read DTO 透传

- Given：GET /spec-workspace
- When：读取
- Then：响应含 last_writer / last_writer_at

### FR-05: DB 迁移

- Given：部署新镜像
- When：alembic upgrade head
- Then：spec_workspaces 增两列（幂等 add_column；downgrade 可回）

### FR-06: 契约与零回归

- Given：schema 变更
- When：gen:types + 定向测试
- Then：api-types/openapi 同步提交；模块 164 passed 1 skipped（含新 2）；mypy 0 错；tsc 0 错（含 change-events 旧债顺手修）

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::TestConsistencyAndWriter::test_consistency_four_divergences（三类分歧+计数断言）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同文件 ::test_writer_recorded_and_switch_warns（首写记录/同写方不变/切换更新）


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同上用例（切换段；warn 为 structlog 面不在断言，service 代码锚 _note_writer）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
api-types.ts/openapi.json 重生成 diff 含 SpecWorkspaceRead.last_writer 字段（gen 产物即证据）


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
migrations/versions/20260926083000（手写迁移，ast 语法校验 + 表名 spec_workspaces 对齐 model __tablename__）


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：backend uv run pytest app/modules/spec_workspace -q --no-cov（164 passed 1 skipped）+ mypy 0 错 + frontend tsc 0 错（5 passed events card）


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：backend uv run pytest app/modules/spec_workspace -q --no-cov（164 passed 1 skipped）+ mypy 0 错 + frontend tsc 0 错（5 passed events card）


<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：backend uv run pytest app/modules/spec_workspace -q --no-cov（164 passed 1 skipped）+ mypy 0 错 + frontend tsc 0 错（5 passed events card）

