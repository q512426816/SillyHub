---
author: flow-machine-draft
created_at: 2026-09-26T15:43:04.971Z
---
# 提案书（Proposal）— 2026-09-26-migration-chain-dedupe

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:fd0bcd3add4a089efce3313dafd0427ec04ab5ea1d8004e3384d18c66f0bc35f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-migration-chain-dedupe 留痕重锚 -->
任务原话转写：迁移链分叉真 bug：20260923040000（change-events-channel）与 20260926063000（change-events-r18-full）是两个变更各写的同名建表迁移（都 down_revision=20260922194500），建表结构还不一致（ts timestamptz vs varchar(64)、severity/rule 可空性、stage 列有无），3931ff71bd32 merge 强行归一。后果：本地 dogfood DB 卡在 063000 时 upgrade head 撞 DuplicateTableError 后端起不来（已手工 stamp 救活）；全新库按分支序应用仍会在第二支 duplicate 炸；远程 DB 表是 040000 旧结构而 ORM 按 063000 语义读写（ts 字符串/rule 非空/无 stage）——类型脱节。

成功标准：
- 迁移链恢复单线：22194500→040000→090000→083000→新矫正迁移，删除 063000 与 merge 3931ff71bd32，083000 的 down_revision 改接 20260923090000
- 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py PlatformChangeEventORM）完全一致的结构（ts String(64)、severity String(16) NOT NULL default info、rule NOT NULL、provisional server_default true、detail Text、无 stage 列）
- 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestamptz→varchar(64) 数据转 ISO 串、severity/rule NULL 回填、severity varchar(32)→16、detail→text、DROP stage），已是目标结构的库全 no-op，SQLite 测试库跳过
- tests/test_migrations_graph.py 守护通过（单头、引用闭合）；新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_migration.py 先例）
- 本地与远程 dogfood/生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端正常启动（运维步骤在交付汇报中列明）
- 不改 ORM、不改任何业务代码与接口行为
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:056457e0f281237dea16fa7dcc59ba849b49fb2bf5dd29dbea5549cee565198d:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-migration-chain-dedupe 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. 迁移链恢复单线：22194500→040000→090000→083000→新矫正迁移，删除 063000 与 merge 3931ff71bd32，083000 的 down_revision 改接 20260923090000
2. 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py PlatformChangeEventORM）完全一致的结构（ts String(64)、severity String(16) NOT NULL default info、rule NOT NULL、provisional server_default true、detail Text、无 stage 列）
3. 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestamptz→varchar(64) 数据转 ISO 串、severity
4. rule NULL 回填、severity varchar(32)→16、detail→text、DROP stage），已是目标结构的库全 no-op，SQLite 测试库跳过
5. tests/test_migrations_graph.py 守护通过（单头、引用闭合）
6. 新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_migration.py 先例）
7. 本地与远程 dogfood
8. 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端正常启动（运维步骤在交付汇报中列明）
9. 不改 ORM、不改任何业务代码与接口行为
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:53390418eece6f3795f63a86d97c058f34537aa896ca9fb486c258ffc5fc5dd2:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-migration-chain-dedupe 留痕重锚 -->
1. 迁移链恢复单线：22194500→040000→090000→083000→新矫正迁移，删除 063000 与 merge 3931ff71bd32，083000 的 down_revision 改接 20260923090000
2. 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py PlatformChangeEventORM）完全一致的结构（ts String(64)、severity String(16) NOT NULL default info、rule NOT NULL、provisional server_default true、detail Text、无 stage 列）
3. 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestamptz→varchar(64) 数据转 ISO 串、severity
4. rule NULL 回填、severity varchar(32)→16、detail→text、DROP stage），已是目标结构的库全 no-op，SQLite 测试库跳过
5. tests/test_migrations_graph.py 守护通过（单头、引用闭合）
6. 新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_migration.py 先例）
7. 本地与远程 dogfood
8. 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端正常启动（运维步骤在交付汇报中列明）
9. 不改 ORM、不改任何业务代码与接口行为
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
