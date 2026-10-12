---
author: flow-machine-draft
created_at: 2026-10-12T07:33:58.483Z
---
# 决策记录（Decisions）— 2026-10-12-spec-backup-keep-forever

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：备份区磁盘增长无上限（阿里云 40G 盘；ql-20260924 生产曾堆积 3.5 万时间戳目录）。缓解：用户已明确选择长期保留（数据安全优先于磁盘）；保留 `SPEC_BACKUP_RETENTION_DAYS` env 逃生门可随时不改代码恢复修剪；磁盘水位由运维监控兜责。次风险：测试经 monkeypatch get_settings 注入，若未来 `_prune_spec_backups` 改为经参数传入 settings，spy 断言形态需同步——已在新用例注释中标注。 死路（试过放弃）：① 直接物理删除 prune 代码与节流基础设施——放弃，逃生门与 OOM 防护仍有价值，且删除面波及三份测试的历史语义；② 用模块常量 `SPEC_BACKUP_RETENTION_DAYS = None` 替代 Settings 字段——放弃，改行为需改代码重发布，违背「运维可调」；Settings 字段与本仓 12-factor 惯例（spec_data_root 等）一致。
