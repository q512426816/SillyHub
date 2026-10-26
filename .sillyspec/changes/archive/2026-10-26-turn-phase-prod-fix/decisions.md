---
author: flow-machine-draft
created_at: 2026-10-26T06:52:54.695Z
---
# 决策记录（Decisions）— 2026-10-26-turn-phase-prod-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：观测部署后证据指向的根因超出 daemon 仓（如 backend SSE 某条件下丢弃）——静态证据已基本排除该向（delivered 可显示证明同信封类型可通），若仍发生则范围扩至 backend 转发链，任务面相应扩。放弃的方案：①盲改可疑点（静态五项排除后命中率低且不可证伪）；②前端超时兜底假阶段（掩盖问题，违反 FR-02 禁绕过）；③上报改同步阻塞换可见性（违反不阻塞主链路语义）。
