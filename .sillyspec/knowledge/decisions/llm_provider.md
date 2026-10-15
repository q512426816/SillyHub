# 决策知识 — llm_provider

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-provider-update-models-none-guard
锚点：未记录
最近确认：87e292759e4934ec73c9c92152c38de97610509e
理由：最大风险：防护误伤「显式清空/替换列表」语义——已排除：清空应传 `[]`（非 None），防护只拦 None，回归用例内双断言钉死。放弃的方案：schema 层 validator 拒收 models=None——会使 openapi anyOf null 契约与字段注释「None=不动」双双失真，且与 api_key/agent_kinds 既有 None-pop 惯例不一致，不采用。
