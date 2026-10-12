---
author: flow-machine-draft
created_at: 2026-10-12T07:50:59.896Z
---
# 设计记录（Design Record）— 2026-10-12-spec-backup-retention-validation

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

依据：上变更 2026-10-12-spec-backup-keep-forever 独立评审 P3-1（`backend/app/core/config.py:264` 字段无正数约束，误配 0/负数令 `_prune_spec_backups` 的 cutoff 晚于全部时间戳目录 → 软删触发即全删备份）与 P3-4（默认 None 早退后 `service.py` FileNotFoundError 容错分支失去直接测试锁定）。

改法：`config.py` 在 `spec_backup_retention_days` 字段后加 `@field_validator`（照同文件 `cli_progress_timezone` 校验器先例，mode=after）：`raw is not None and raw < 1` 抛 `ValueError`，错误信息写明「None 或正整数」。pydantic 在 Settings 构造期执行 → 容器启动即 fail-fast，误配到不了运行期。测试两处：`backend/tests/test_config.py` 加 0/-3 拒绝与 None/90 放行两用例（该文件已有 `Settings()` 直构 + `monkeypatch.setenv` + `pytest.raises` 先例 `test_secret_key_min_length`）；`test_soft_delete_change_dir.py` 的 `test_missing_backup_root_is_noop` 改双断言形态——默认 None 与注入 30 各跑一次不存在根，恢复 FileNotFoundError 分支锁定。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `Settings` 新增校验器 `_validate_spec_backup_retention_days`：字段值域从「任意 int | None」收紧为「None | 正整数」，0/负数在构造期抛 `ValueError`（env `SPEC_BACKUP_RETENTION_DAYS` 同受约束——pydantic 先类型解析再校验）。
- `SpecWorkspaceService._prune_spec_backups`：签名与运行期行为零变化（校验后能进入运行期的值域本就走既有分支）；仅测试文件补用例。
- 对外 HTTP 端点 / CLI 命令 / 文件格式：无任何变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。校验发生在 Settings 单次构造（进程启动期），无异步输入面；运行期消费该值的 `_prune_spec_backups` 与到达顺序无关（上变更已论证），本变更只收窄值域不改执行时序。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不涉及。校验器是纯函数（同一输入同结果，无共享态）；`get_settings()` 进程级缓存的行为不变（先构造后缓存，构造失败即进程起不来，不存在半配置并发消费）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。唯一行为变化点在进程启动期：误配容器直接 crash（fail-fast 语义正是本变更目的，运维改 env 重启即修复）；存量部署未配该 env（默认 None）零影响，热更新/滚动重启无状态迁移。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。校验是全局 Settings 级（与上变更的保留天数作用域一致）；多实例各自独立构造校验，一个实例误配只拒止自己，不影响其他实例与既有备份数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：存量自动化脚本若曾以 0/负数「临时禁用修剪」会在升级后启动失败——调研结论：禁用修剪的正确形态就是缺省 None（上变更引入），0/负数在上变更代码里语义是「立即全删」而非「禁用」，不存在合法依赖场景，破坏面为误配纠偏。

死路（试过放弃）：① 在 `_prune_spec_backups` 运行期钳制（<1 视作 None 跳过）——放弃，静默吞掉误配违背 fail-fast，误配者得不到任何信号，且每次调用重复判断；② 用 `Field(gt=0)` 约束——放弃，`gt=0` 无法表达 None 缺省合法（pydantic 对 None 也走约束），需与 `int | None` 叠加特殊处理，field_validator 显式直白且与同文件先例一致。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | backend/app/core/config.py | `spec_backup_retention_days` 加 field_validator：None/正整数合法，0/负数构造期抛 ValueError |
| 改 | backend/tests/test_config.py | 新增拒绝（0/-3）与放行（None/90）两用例 |
| 改 | backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py | `test_missing_backup_root_is_noop` 双形态：默认 None + 注入 30（恢复 FileNotFoundError 分支锁定） |
