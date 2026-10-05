---
author: flow-machine-draft
created_at: 2026-10-05T23:07:17.583Z
---
# 决策记录（Decisions）— 2026-10-06-litellm-log-rotation

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：轮转上限过小导致 crash-loop 排障时关键 traceback 被截丢——取 10m×3=30m 兼顾低配磁盘与排障留存（该服务已设 PYTHONUNBUFFERED=1，崩溃 traceback 即时 flush，单份 10m 足够装下完整崩溃记录）。试过但放弃的方案：①宿主 daemon.json 全局默认轮转——动服务器系统状态、影响所有容器，超出本仓变更面；②全服务统一 logging——核心服务日志保留策略变化未评估，扩大行为面，留待专门变更。
