---
author: flow-machine-draft
created_at: 2026-10-25T12:39:32.991Z
---
# 决策记录（Decisions）— 2026-10-25-fe-build-unblock

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：风险可忽略：`?.` 与 `?? null` 在 i>0 且元素必存在的构造下与原 `.whoLine` 等值。试过放弃的方案：把测试 opts 类型改为 LlmProviderRead[]（需 import + 464/504 fixture 补齐必填字段，改动面扩大且可能引出 agent_kinds 类新错）——放弃，取 never[] 边界断言最小面。
