---
author: flow-machine-draft
created_at: 2026-10-09T07:37:42.730Z
---
# 决策记录（Decisions）— 2026-10-09-close-trace-single-set-platform

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：CLI 新形态落盘字段与前端特征判定脱节（如 files 非数组）——已知防御：特征判定失败回落 JsonView 折叠树（既有机制），不白屏。放弃方案：改后端 assets.py 读 scopeAudit 子对象做投影——顶级字段（files/totals/patchStatus/savedAt）已含卡面全部所需，子对象仅前端预览增值面，动后端是无效改动面。
