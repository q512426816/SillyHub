---
author: flow-machine-draft
created_at: 2026-10-12T06:12:35.144Z
---
# 设计记录（Design Record）— 2026-10-12-spec-backup-keep-forever

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

背景与决策源：2026-10-10 消防项目（workspace 4e9eb05b）的 `2026-10-10-fire-equipment` 等变更文件被同步链路软删进服务器备份区后，受 30 天修剪机制约束险些丢失（本次在窗口期内经备份区找回）。用户明确要求「去掉保留时长，长期保留」。

改法（依据现有代码）：`backend/app/modules/spec_workspace/service.py:126` 的模块常量 `SPEC_BACKUP_RETENTION_DAYS = 30` 是修剪天数的单一来源（消费点 `:2043` cutoff 计算），`_prune_spec_backups`（`:2023`）是唯一执行体，调用点仅两处（`:1986` 收敛、`:2146` 软删）。本变更把保留天数升级为 Settings 配置项 `spec_backup_retention_days: int | None`（默认 None = 永不修剪）：`_prune_spec_backups` 头部读 `get_settings().spec_backup_retention_days`，为 None 直接 return（在节流记账之前返回，零扫描零副作用）；为正整数则沿用原 cutoff + 节流 + scandir 逻辑不变。配置字段放 `backend/app/core/config.py` Settings（pydantic BaseSettings + Field 惯例，env 自动映射 `SPEC_BACKUP_RETENTION_DAYS`），运维可不改代码调整或恢复修剪。测试侧沿用本仓 monkeypatch get_settings 注入惯例（先例：agent/tests/test_patrol.py）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `Settings` 新增字段：`spec_backup_retention_days: int | None`，默认 None；env 名 `SPEC_BACKUP_RETENTION_DAYS`（case_sensitive=False）。None=永不修剪；正整数 N=机会式修剪早于 N 天的备份目录。
- `SpecWorkspaceService._prune_spec_backups` 行为变化：默认配置下成为纯 no-op（不再扫描、不再删除）；显式配置天数时行为与原实现逐字节一致（同一 cutoff 语义、同一节流窗口、同一保守跳过规则）。
- 删除模块常量 `SPEC_BACKUP_RETENTION_DAYS`（唯一消费点在 `_prune_spec_backups` 内部，测试引用一并迁移到设置注入）。
- 对外 HTTP 端点 / CLI 命令 / 文件格式：无任何变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。修剪仅在软删/收敛批次末尾机会式触发，与 op 到达顺序无关；默认 None 时完全无行为，乱序/重放（ql-20260924 delete 重放风暴形态）零影响。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

启用修剪时既有防护不变——`_prune_lock` 串行化节流记账，单批至多一次扫描；备份目录名含微秒时间戳（BACKUP_TS_FORMAT），并发软删不会写同一目录。None 时无扫描即无竞争面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。部署切换（旧常量 30 → 新默认 None）只影响切换后的调用，无持久化状态需要迁移；已存在的备份目录不受影响；正在进行的软删事务与修剪解耦（修剪在事务外 to_thread 执行，维持原状）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。保留天数是全局设置，不区分 workspace——多工作区共享同一策略（与原模块常量语义一致，无回归）；各 workspace 修剪只动各自 `spec-backups/{ws}/` 子树，无跨工作区串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：备份区磁盘增长无上限（阿里云 40G 盘；ql-20260924 生产曾堆积 3.5 万时间戳目录）。缓解：用户已明确选择长期保留（数据安全优先于磁盘）；保留 `SPEC_BACKUP_RETENTION_DAYS` env 逃生门可随时不改代码恢复修剪；磁盘水位由运维监控兜责。次风险：测试经 monkeypatch get_settings 注入，若未来 `_prune_spec_backups` 改为经参数传入 settings，spy 断言形态需同步——已在新用例注释中标注。

死路（试过放弃）：① 直接物理删除 prune 代码与节流基础设施——放弃，逃生门与 OOM 防护仍有价值，且删除面波及三份测试的历史语义；② 用模块常量 `SPEC_BACKUP_RETENTION_DAYS = None` 替代 Settings 字段——放弃，改行为需改代码重发布，违背「运维可调」；Settings 字段与本仓 12-factor 惯例（spec_data_root 等）一致。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | backend/app/core/config.py | Settings 新增 `spec_backup_retention_days: int \| None = None` 字段 |
| 改 | backend/app/modules/spec_workspace/service.py | 删 `SPEC_BACKUP_RETENTION_DAYS` 常量；`_prune_spec_backups` 头部读设置，None 早退（零扫描），正整数走原逻辑 |
| 改 | backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py | TestPruneSpecBackups 三例改设置注入 + 新增「默认永不修剪」锁死用例 |
| 改 | backend/app/modules/spec_workspace/tests/test_sync_incremental.py | TestBackupPrune API 级用例注入 30 天（验证逃生门语义） |
