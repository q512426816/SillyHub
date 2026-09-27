---
author: flow-machine-draft
created_at: 2026-09-25T05:20:23.143Z
---
# 需求规格（Requirements）— 2026-09-25-spec-sync-pg-chunk

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 批量 upsert 分片
Given 单批 spec-sync ops 含数千 add（归档移动整树形态）
When apply_ops 写 manifest
Then 按 500/批分片执行 pg_insert upsert，单语句绑定参数恒低于 asyncpg 32767 上限，行级语义（版本高位对齐/exists/幂等）逐字不变

### FR-02: 超大批全量落库
Given 一次同步推送 1200 个 add
When 处理完成
Then 1200 行全落 manifest（批边界与尾批不丢行）、文件全写盘、版本/哈希正确

### FR-03: 既有增量同步零回归
Given 本变更交付
When 跑 spec_workspace 增量同步既有测试
Then 全绿（本次 33 passed 1 skipped，skip 为既有 Windows symlink 平台跳过）
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: pending_adds 批量 upsert 按固定批大小分片执行（批大小使单语句绑定参数远低于 32767，含安全余量），行级 upsert 语义逐字不变（on_conflict_do_update 同款）
FR-02: 超大批功能测试：>批大小数倍的 pending adds 全部落库且版本/哈希正确（sqlite 测试库虽无该上限，分片循环的正确性可验）
FR-03: 既有 spec_workspace apply_ops 相关测试零回归
FR-04: 生产部署后 spec-sync 恢复（CLI 重试成功、镜像更新、变更详情文件/文档数据回填）
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/spec_workspace/tests/test_spec_sync_chunk.py::test_bulk_adds_chunked_all_applied（1200 add 三批全落 + 尾批行核验）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同文件两用例（含 test_bulk_adds_replay_idempotent_after_chunking：重放不膨胀）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
uv run pytest app/modules/spec_workspace/tests/test_spec_sync_chunk.py app/modules/spec_workspace/tests/test_sync_incremental.py → 33 passed 1 skipped（回执 .sillyspec/.runtime/logs/c4-test.log）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
不适用：输入成功标准仅三条（FR-04 为部署验证项，属运维动作非测试面）——生产部署后以 spec-sync 恢复 + 镜像更新 + 变更详情回填为验收（见收尾汇报）。
