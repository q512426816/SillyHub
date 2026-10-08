---
author: flow-machine-draft
created_at: 2026-10-08T00:36:19.669Z
---
# 提案书（Proposal）— 2026-10-08-provider-update-models-none-guard

## 动机

任务原话转写：PATCH /llm-providers 显式 models=null 违反 schema 声明的 None=不动 契约，None 进入 setattr 撞 models NOT NULL 列返回 500（与 44eb2e5c9 修复的 agent_kinds 同型，b8afd807c 合入的 models 列漏配同款防护）
成功标准：
- service.update() 对 models 做显式 None-pop，与 agent_kinds 既有防护同款对齐
- PATCH body models=null 不再 500，原模型列表保持不变（补回归测试覆盖）
- 本模块相关测试文件全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. service.update() 对 models 做显式 None-pop，与 agent_kinds 既有防护同款对齐
2. PATCH body models=null 不再 500，原模型列表保持不变（补回归测试覆盖）
3. 本模块相关测试文件全绿

## 成功标准（可验证）

1. service.update() 对 models 做显式 None-pop，与 agent_kinds 既有防护同款对齐
2. PATCH body models=null 不再 500，原模型列表保持不变（补回归测试覆盖）
3. 本模块相关测试文件全绿
