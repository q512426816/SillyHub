---
author: flow-machine-draft
created_at: 2026-09-26T15:43:04.972Z
---
# 需求规格（Requirements）— 2026-09-26-migration-chain-dedupe

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 迁移链恢复单线：22194500→040000→090000→083000→新矫正迁移，删除 063
Given 迁移 相关模块就绪
When 迁移链恢复单线：22194500
Then 040000

### FR-02: 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py P
Given 系统就绪
When 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py PlatformChangeEventORM）完全一致的结构（
Then 行为符合本条标准描述

### FR-03: 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestampt
Given 迁移 / 幂等 相关模块就绪
When 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestamptz
Then varchar(64) 数据转 ISO 串、severity

### FR-04: rule NULL 回填、severity varchar(32)→16、detail→text、D
Given 测试 相关模块就绪
When rule NULL 回填、severity varchar(32)
Then 16、detail

### FR-05: tests/test_migrations_graph.py 守护通过（单头、引用闭合）
Given 系统就绪
When tests/test_migrations_graph.py 守护通过（单头、引用闭合）
Then 行为符合本条标准描述

### FR-06: 新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_mi
Given 迁移 / 测试 相关模块就绪
When 新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_migration.py 先例）
Then 行为符合本条标准描述

### FR-07: 本地与远程 dogfood
Given 系统就绪
When 本地与远程 dogfood
Then 行为符合本条标准描述

### FR-08: 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端
Given 系统就绪
When 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端正常启动（运维步骤在交付汇报中列明）
Then 行为符合本条标准描述

### FR-09: 不改 ORM、不改任何业务代码与接口行为
Given 接口 相关模块就绪
When 不改 ORM、不改任何业务代码与接口行为
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure::test_file_exists_and_single_head_chain（单 head=20260926234000）
- backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure::test_duplicate_branch_purged（063000/3931ff71bd32 彻底移出）
- backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure::test_083000_reattached_to_mainline（down_revision 接 20260923090000）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/tests/test_migrations_graph.py（全链 AST 守护：revision 唯一/引用闭合/单头，重写后的 040000 在链上图形态不变）
- 不适用（DDL 内容等价性）：040000 重写的 create_table 与 ORM 对齐由矫正迁移测试的目标结构形态（TARGET_SHAPE）+ 本地真库升级后 information_schema 实测（FR-07 运维验证）覆盖，无独立单测面

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_old_shape_emits_full_alignment（旧结构 → 全部对齐 DDL：ts USING to_char/severity·rule 收紧/detail→text）
- backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_target_shape_is_full_noop（目标结构 → 零 DDL）
- backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_sqlite_dialect_short_circuits（非 PG 方言整体 no-op）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/tests/test_align_platform_change_events_migration.py::TestAlignBehavior::test_old_shape_emits_full_alignment（断言 SET severity='info' WHERE NULL / SET rule='' WHERE NULL / DROP COLUMN stage 明细）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/tests/test_migrations_graph.py（全量守护用例，重跑全绿）

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/tests/test_align_platform_change_events_migration.py::TestMigrationStructure（文件存在/单 head/revision 链/分支清除四断言，仿 test_archive_tombstone_repair_migration.py 先例）

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- 不适用（运维验证，非 pytest 面）：本地 dogfood 库已实跑——alembic_version 20260926083000 → 容器 entrypoint upgrade head 到 20260926234000（矫正全 no-op），information_schema 实测表结构=ORM 目标（ts varchar/rule·severity NOT NULL/detail text/无 stage），health 200；证据在交付汇报

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- 不适用（生产运维验证，非 pytest 面）：远程 stamp 083000 + 部署新镜像 upgrade head 走矫正真实 ALTER/数据转换（166 行），部署后核验表结构与 version_num=20260926234000——随本次交付一并执行

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/tests/test_migrations_graph.py（链图守护证明变更面仅 migrations/versions）
- backend/app/modules/platform_sync 全量 264 passed（4 失败为 HEAD 存量债，git stash 干净 HEAD 复跑同败，已按先例记 local.yaml known_failures Q 组豁免）
- backend/tests/test_align_platform_change_events_migration.py（新守护只读迁移文件，零业务代码触碰）
