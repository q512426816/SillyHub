---
author: flow-machine-draft
created_at: 2026-10-08T01:03:54.575Z
---
# 决策记录（Decisions）— 2026-10-08-provider-update-models-none-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：防护误伤「显式清空/替换列表」语义——已排除：清空应传 `[]`（非 None），防护只拦 None，回归用例内双断言钉死。放弃的方案：schema 层 validator 拒收 models=None——会使 openapi anyOf null 契约与字段注释「None=不动」双双失真，且与 api_key/agent_kinds 既有 None-pop 惯例不一致，不采用。
