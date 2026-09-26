---
author: flow-machine-draft
created_at: 2026-09-26T15:43:04.972Z
---
# 任务注册表（Tasks）— 2026-09-26-migration-chain-dedupe

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: 迁移链恢复单线：22194500→040000→090000→083000→新矫正迁移，删除 063000 与 merge 3931ff71bd32…
- [ ] task-02: 040000 的建表 DDL 改写为与当前 ORM（platform_sync/model.py PlatformChangeEventORM）完全一致的结构（…
- [ ] task-03: 新增条件矫正迁移：对已被 040000 旧结构建表的 PG 库做幂等对齐（ts timestamptz→varchar(64) 数据转 ISO 串、severi…
- [ ] task-04: rule NULL 回填、severity varchar(32)→16、detail→text、DROP stage），已是目标结构的库全 no-op…
- [ ] task-05: tests/test_migrations_graph.py 守护通过（单头、引用闭合）
- [ ] task-06: 新增矫正迁移的结构断言与链测试（仿 test_archive_tombstone_repair_migration.py 先例）
- [ ] task-07: 本地与远程 dogfood
- [ ] task-08: 生产 DB 经 stamp+upgrade head 后 alembic 版本落新 head 且后端正常启动（运维步骤在交付汇报中列明）
- [ ] task-09: 不改 ORM、不改任何业务代码与接口行为
