---
author: flow-machine-draft
created_at: 2026-09-25T05:03:12.145Z
---
# 需求规格（Requirements）— 2026-09-25-tombstone-heal-archive

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: archived 载荷复活 deleted 冤案行
Given 平台 Change 行 location='deleted'（旧 CLI 墓碑 bug 误标）且 upsert_progress 收到新 CLI 重推的 'archived' 载荷（body changes[] 同名条目 status=='archived'）
When 已删探测命中走拒收分支
Then 行翻回 location='archive' 并走正常接受分支（面板「已归档」tab 恢复可见）；行缺失/仅 manifest 兜底判据命中/真删除链（本地 status='deleted'）不复活，维持原拒收

### FR-02: archived 墓碑不触发镜像软删
Given _apply_cli_tombstone 收到 status=='archived' 的墓碑载荷
When 处理 tombstone
Then no-op 早退：不动 location（P1 ingest 不变量，收敛归文件移动 + reparse）、不软删 spec 镜像（归档可回溯，区别于 deleted 链）；行为与原「非 deleted 早退」等价，注释钉住语义

### FR-03: 聚焦测试全绿
Given 本变更交付
When 跑 test_change_deleted_guard.py
Then 三新用例（恢复/不软删/幂等）+ 既有 13 用例全绿（16 passed 实测）

### FR-04: 不变量守恒
Given D-002@v1（reparse 是 location owner）与 P1 ingest 不变量
When 本变更落库
Then 复活通道是唯一新增 location 写点且仅 deleted→archive 单向；镜像不软删不恢复
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: upsert_progress 已删拒收分支加复活通道：body changes[] 同名条目 status=='archived' 且行 location=='deleted' 时翻回 archive 走正常接受，否则维持原拒收（真删除链零回归）
FR-02: _apply_cli_tombstone 的 archived 分支语义化 no-op（行为与原早退等价，钉住不软删镜像/不动 location 的不变量注释）
FR-03: test_change_deleted_guard.py 三新用例（恢复/不软删/幂等）+ 既有 13 用例全绿（16 passed 实测）
FR-04: 尊重 D-002@v1 与 P1 ingest 不变量：不新增 location 写路径竞争（复活通道是唯一新增写点且仅 deleted→archive 单向）
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_change_deleted_guard.py::test_cli_tombstone_archived_restores_location_archive

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_change_deleted_guard.py::test_cli_tombstone_archived_no_mirror_soft_delete（含幂等 test_cli_tombstone_archived_idempotent）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
uv run pytest app/modules/platform_sync/tests/test_change_deleted_guard.py -q --no-cov → 16 passed（回执 .sillyspec/.runtime/logs/c3-test.log）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
不适用：设计不变量（唯一新增写点=复活通道且单向），由 FR-01/02 行为用例与既有 test_archived_terminal_persists（P1 锚，不在本 diff 内零改动）共同锁定。
