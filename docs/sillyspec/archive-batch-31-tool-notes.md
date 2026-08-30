---
author: qinyi
created_at: 2026-08-30 20:45:00
---

# 批量归档 31 变更中的工具观察（2026-08-30）

> 状态：活跃坑（小）；均不阻断归档，记录备查。

## 1. workflow-runs 产物文件名误标 `fail`

现象：`sillyspec run archive` step 2（extract-module-impact）成功完成且 CLI 明确打印「✅ module-impact.md 检查通过」，但
`.runtime/workflow-runs/` 里对应产物文件名仍为 `…-archive-impact-multi-agent-platform-fail.json`。疑似以内部子流程
（module-impact 骨架生成降级）的退出态命名整份产物，与步骤最终成功态矛盾。

影响：低（仅排查时会误导）。建议：产物文件名按步骤最终校验结果命名，降级子流程另记字段。

## 2. 老变更 DB 步骤表漂移时 `--confirm` 提示与实际行为不符

现象：对 DB 中 archive 步骤表为旧定义（5 步）的变更执行 `sillyspec run archive --done --confirm`，CLI 连续 3 次
打印「⚠️ 请添加 --confirm 确认归档」后第 4 次实际以 --confirm 语义完成（目录正常移动、状态机推进到 step 6）。
同批出现「⚠️ archive 步骤表与当前定义漂移（DB 5 步 → 定义 6 步）」告警，推断漂移重映射期间 confirm 标志被吞。

影响：低（重试即成，最终行为正确）；但提示文案会让操作者误以为参数没带。建议：漂移重映射后透传原始 flags，
或提示改为「正在按新步骤表重放，请重试同一命令」。

## 3. 非缺陷备注

- `sillyspec module-impact` 对早于 review.json/impact 机制的老变更报「无 module-map 或无 diff 文件可归类——骨架无从生成，
  agent 全手写」——这是文档化的降级路径，按提示全手写即可，不算缺陷。
- decision-distill 对无 `impacts` 域字段的老 decisions.md 兜底归 `decisions/unmapped.md`，与既往归档先例一致。
