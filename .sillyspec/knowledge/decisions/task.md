# 决策知识 — task

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-taskboard-tasks-md
锚点：未记录
最近确认：fbf4ae2753b9bbf2a14d929ecd2c900b533d6100
理由：最大风险：thin 行 status 只有 draft/done 两态（看板中段列空）——勾选态是 tasks.md 唯一信号，不造无据状态；后续要更细可由 status 映射规则扩展。试过放弃：把注册表行也建成卡片式富结构（priority/owner 从行文猜测）——无据造数；放弃，只取确定字段。
