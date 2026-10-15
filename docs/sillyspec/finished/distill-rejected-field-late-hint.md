# decision-distill 对 rejected 条目的「否决理由/复潮条件」字段要求仅后置提示

> 记录时间：2026-10-15 · 来源变更：2026-10-14-admin-server-status（archive step1 实证）
> 状态：活跃坑（补字段重跑幂等，绕过轻，待工具前置提示）

## 现象

- brainstorm 阶段的决策条目模板（skill 注入的 D-xxx@vN 九字段：type/priority/status/source/
  question/answer/normalized_requirement/impacts/evidence + 可选 故障面/退役判据）**不含**
  「否决理由：/复潮条件：」字段——rejected 条目按模板把否决理由写在 answer 散文里完全合规；
- archive step1 decision-distill 提炼时报 `rejected 决策缺否决理由/复潮条件（needsWait）——
  该条目未写盘`，要求归档前补字段或用户裁决跳过。

解析器实际认的字段名（decision-distill.js:87-88）：`否决理由|reject_reason|rejectReason`、
`复潮条件|revisit_when|revisitWhen`——字段名没问题，问题是**要求只在最后一步才浮出**。

## 影响

- 每个 含 rejected 决策的变更在归档门口多一轮「补字段→重跑 distill」往返；
- 若 agent 没留意 needsWait 直接 --confirm，rejected 条目静默不入库（防复潮通道漏一条）。

## 绕过

给 rejected 条目补独立字段行后重跑 distill（幂等，已入条目 action=update 不重复）：

```
- 否决理由: <一句话核心劣势>
- 复潮条件: <何种信号下可重议>
```

## 修复建议

1. brainstorm 写 decisions.md 的模板对 `status: rejected` 条目前置追加这两个字段（模板按
   status 条件渲染，accepted 条目不受扰）；
2. 或 distill 的 needsWait 报错附可复制的补丁样例（现在给了 node 重跑命令但没给字段样例，
   样例藏在源码 case 分支里）。

## 处置记录（2026-10-15）

**已修**（sillyspec `2026-10-15-pitfall-batch-clearance`，归档 a493aef1，两轮评审 PASS）：
brainstorm 决策条目模板对 `status: rejected` 条目**前置渲染**「否决理由:/复潮条件:」两字段
（accepted 条目不受扰）——rejected 决策在写入时即带 distill 入库所需字段，归档门口的
「补字段→重跑」往返消除；needsWait 仍作兜底门（写侧漏配时不静默丢条目）。归档。
