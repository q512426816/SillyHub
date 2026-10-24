---
author: flow-machine-draft
created_at: 2026-10-24T04:29:36.124Z
---
# 决策记录（Decisions）— 2026-10-24-backend-mem-limit-raise

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：若后续再引入第三类常驻模型 worker 或批量推理峰值再涨，2500m 仍可能触顶——但 cgroup OOM 兜底行为不变（杀 worker 保主进程），且宿主 7.5G 对 2500m 上限仍有 3G+ 安全边际，风险可控。放弃的方案：①worker 拆独立 sidecar 容器（治本但改部署管线与进程拓扑，改动面大，超出本次决策范围）；②调小嵌入/翻译批上限（治标：压峰不治底，主进程+单 worker 稳态仍贴 1100m 顶，且推理延迟恶化）；③不设 mem_limit（失去 OOM 隔离，宿主与其它容器暴露在被挤爆风险下）。
