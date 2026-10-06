---
author: qinyi
created_at: 2026-10-06 14:33:00
plan_level: full
ceremony_tier: independent
---

# 实现计划（Plan）— 2026-10-06-provider-multi-agent-kind

> 依据 design.md（Grill 两轮 pass）拆解。Wave 间按依赖串行；Wave1 内 task-02/task-03 同触 service.py 但改动函数不相交且 depends_on 串行兜底（plan 评审 P2-1 备案）。
> ceremony_tier=independent（schema 迁移 + 解析链四路径 + 热切换扇出，风险客观定价独立评审）。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03
- task-04
- task-08

## Wave 4（依赖前序 Wave）
- task-05
- task-06
- task-09

## Wave 5（依赖前序 Wave）
- task-07
- task-10

## Wave 6（依赖前序 Wave）
- task-11

## 全局硬约束（绑定所有 task）

- MUST NOT 改 sillyhub-daemon 仓任何文件（注入链契约零改动，D-005）。
- provider_config.agent_kind MUST 恒为会话引擎值（claim/切换/扇出三路一致，FR-05）。
- 同 (user_id, 引擎) 默认互斥 MUST 恒成立（含扩张场景清新增引擎兄弟默认，D-006/FR-03）。
- 存量迁移 MUST 值域不变（单值→[单值]，FR-02）；MUST NOT 合并/清理存量重复行（D-002）。
- api_format=openai_chat 且集合含 pi MUST 422（后端）/前置禁用（前端）（FR-04）。
- 预设 llmProviderPresets.ts MUST NOT 触碰（无 agent_kind 字段，Grill P2-1）。
- 未上线无过渡期：API 直接切换数组字段，前后端同批收口（规则 11）。

## FR 覆盖索引

- FR-01 多选与双引擎命中 → task-01/02/04/08/11
- FR-02 存量迁移等价 → task-01/07
- FR-03 默认全引擎与互斥（含扩张） → task-03/07/11
- FR-04 pi×openai 组合禁配 → task-02/08/10/11
- FR-05 解析集合化与契约保持（扇出） → task-04/05/06/07/11

## 依赖说明

- Wave1 → Wave2：解析链消费新列 agent_kinds 与新 DTO。
- Wave2 → Wave3：测试断言针对扇出/互斥实现。
- Wave1 → Wave4：前端类型来自 gen:types（后端 DTO 定型后才生成）。
- Wave4 → Wave5：交互测试与 UI 验收依赖前端实现。
- task-09 的 gen:types 在 Wave1 完成后即可执行，但保守排在 Wave4 统一收口（避免 openapi 反复再生成）。
