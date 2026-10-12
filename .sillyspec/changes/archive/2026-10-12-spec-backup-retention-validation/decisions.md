---
author: flow-machine-draft
created_at: 2026-10-12T08:23:10.310Z
---
# 决策记录（Decisions）— 2026-10-12-spec-backup-retention-validation

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：存量自动化脚本若曾以 0/负数「临时禁用修剪」会在升级后启动失败——调研结论：禁用修剪的正确形态就是缺省 None（上变更引入），0/负数在上变更代码里语义是「立即全删」而非「禁用」，不存在合法依赖场景，破坏面为误配纠偏。 死路（试过放弃）：① 在 `_prune_spec_backups` 运行期钳制（<1 视作 None 跳过）——放弃，静默吞掉误配违背 fail-fast，误配者得不到任何信号，且每次调用重复判断；② 用 `Field(gt=0)` 约束——放弃，`gt=0` 无法表达 None 缺省合法（pydantic 对 None 也走约束），需与 `int | None` 叠加特殊处理，field_validator 显式直白且与同文件先例一致。
