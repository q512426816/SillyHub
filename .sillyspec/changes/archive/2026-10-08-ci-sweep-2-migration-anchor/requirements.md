---
author: flow-machine-draft
created_at: 2026-10-08T15:49:53.431Z
---
# 需求规格（Requirements）— 2026-10-08-ci-sweep-2-migration-anchor

## 功能需求

### FR-01: test_align_platform_change_events_migration.py 链尾锚更新为 20261008100000（注释链同步），该文件全绿

- 链尾锚断言 必须 等于当前唯一 head 20261008100000，注释链 必须 记录 20261006200000→20261008100000 接续。

#### 场景：主路径

Given versions 目录含 20261008100000（down_revision=20261006200000）/ When test_file_exists_and_single_head_chain 执行 / Then heads 长度 1 且等于 20261008100000，文件全绿。

### FR-02: backend-ci 推送后转绿（其余 workflow 无后端改动不触发或保持绿）

- 链尾锚断言 必须 等于当前唯一 head 20261008100000，注释链 必须 记录 20261006200000→20261008100000 接续。

#### 场景：主路径

Given versions 目录含 20261008100000（down_revision=20261006200000）/ When test_file_exists_and_single_head_chain 执行 / Then heads 长度 1 且等于 20261008100000，文件全绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/test_align_platform_change_events_migration.py「TestMigrationStructure::test_file_exists_and_single_head_chain」（本地 7 用例全绿实证）
FR-02: 不适用：CI 门（backend-ci 转绿以推送后 GitHub Actions 实跑为准，盯到全绿）
