---
author: flow-machine-draft
created_at: 2026-10-13T08:50:00.000Z
---
# 设计记录（Design Record）— 2026-10-13-anchor-mismatch-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：「轮归开始时上下文」的运行时语义在「整个变更生命周期（flow start→done）发生在单轮内」时把整轮锚到上一个变更——实测两例（10-10 fire-equipment 厚流程巨轮 126 命令、10-13 form-strict 9 命令），都是人工按命令证据链逐例修正的，无系统化检出。

方案：给既有回填服务/脚本加错配扫描与修复模式。判定规则：交互轮（spec_strategy=interactive）的**全部已解析**绑定命令一致指向 X 且轮锚 != X → 错配；混合指向（切换轮）不触发——保住既有「切换轮归旧上下文 ≤1 轮误差」裁决；主导型（top ≥80% 且 ≥5 条）仅报告。批量两条查询（工作区交互轮 + 命令日志 JOIN），零 N+1。为什么不做 token 按时间比例分摊：轮内无逐轮 token，编造精度，弃。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `backfill_service.py` 新增：`AnchorMismatch` dataclass（run_id/current_anchor/target/commands/unknown_keys）、`DOMINANT_SHARE=0.8`、`DOMINANT_MIN_COMMANDS=5`、`scan_anchor_mismatches(db, workspace_id) -> (list[AnchorMismatch], list[AnchorMismatch])`（一致错配、主导型信息项，只读）、`fix_anchor_mismatches(db, workspace_id) -> int`（一致错配重锚，单事务由调用方控制）；复用 `_parse_change_key_from_log` 与 Change 行解析。
- `backfill_run_change_context.py` 新增 `--mismatch` 模式（报告/与 --apply 组合落库；--workspace 与 --yes 语义沿用）；既有 `--workspace` 回填模式不动。
- 无 API/DTO 变化（不需 gen:types）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：一致性判定与命令顺序无关（全部指向同一 X 才触发）；日志排序 (timestamp,id) 只影响报告呈现顺序，不影响判定与修复结果。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

报告只读；修复为单事务 UPDATE change_id，与线上 inject（只读 run.change_id）无写冲突，submit 通道不写既有 run 的 change_id；极端并发下修复幂等收敛。建议低峰执行同既有回填。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：混合命令轮（切换轮）显式排除——既有 ≤1 轮裁决不变；修复幂等（锚已等于 X 的轮跳过）；单事务中断即整体回滚。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：change_key 一律按工作区 Change 行解析；派发轮（spec_strategy != interactive）显式排除——派发锚来自 task 权威链，不因会话命令改写。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：一致指向 X 的轮内实际可能混有上一变更的收尾工作（命令只测到 sillyspec 调用面）——重锚会把这点收尾量记给 X。裁决为可接受：这是既有数据下最优归属，且比现状（整轮错挂上一变更、X 空卡）显著更接近真实；已在报告中呈现命令数供人工复核。

试过但放弃：
- 自动修主导型（80% 阈值）——阈值武断且巨轮类形态（126/150 含已删变更命令）语义复杂，降级为仅报告人工裁决；弃。
- token 按消息数比例分摊——无逐轮 token，编造精度；弃。
- 扩展到非交互轮——派发锚是 task 权威链，会话命令不应改写；弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/backfill_service.py | 新增 AnchorMismatch/常量/scan_anchor_mismatches/fix_anchor_mismatches |
| 修改 | backend/scripts/backfill_run_change_context.py | 新增 --mismatch 模式（报告/--apply 落库/--yes 门沿用） |
| 修改 | backend/app/modules/change/tests/test_backfill_run_context.py | 新增错配扫描/修复/排除/幂等/主导型用例 |
