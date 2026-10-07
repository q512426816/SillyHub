---
author: qinyi
created_at: 2026-10-06 21:25:00
plan_level: heavy
ceremony_tier: independent
---

# 实现计划（Plan）— 2026-10-06-provider-model-list

> 依据 design.md（Grill 四轮 6×P1 全修）拆解。Wave 间按依赖串行。
> ceremony_tier=independent（四旧列迁移 + 三消费链 + 注入契约锁定，风险客观定价独立评审）。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03
- task-04
- task-05
- task-08

## Wave 4（依赖前序 Wave）
- task-06
- task-09

## Wave 5（依赖前序 Wave）
- task-07
- task-10

## Wave 6（依赖前序 Wave）
- task-11

## 依赖说明

- Wave1 → Wave2：消费链读新 models 列。
- Wave2 → Wave3：测试断言针对折算/门控/选模型实现。
- Wave1 → Wave4：前端类型来自 gen:types。
- Wave4 → Wave5：交互测试与验收依赖前端实现。
- task-04 与 task-05 无共享文件可并行，保守串行。

## 全局硬约束（绑定所有 task）

- MUST NOT 改 sillyhub-daemon 仓任何文件（injector 消费键 model/model_role_mappings/default_fallback_model 形态逐字保持）。
- provider_config 的 model 与 default_fallback_model 两键 MUST 同值 = 会话所选 ?? 主模型（sonnet 首条 ?? 列表首条）。
- 存量折算候选集 MUST 含 [model] + [default_fallback_model] + 4 槽值（去重保序）。
- 四旧列（model/model_role_mappings/multimodal/default_fallback_model）MUST 全删（迁移与 ORM 口径一致）。
- 附件门控未命中模型名 MUST 保守 false。
- 预设 llmProviderPresets.ts MUST NOT 触碰。
- 未上线无过渡期：API 直接切换（规则 11）。

## FR 覆盖索引

- FR-01 模型列表与角色标记 → task-01/02/04/08/11
- FR-02 多模态下沉 → task-02/05/07/11
- FR-03 会话选模型 → task-06/09/11
- FR-04 注入折算契约保持 → task-04/07
- FR-05 存量折算 → task-01/07
