---
author: flow-machine-draft
created_at: 2026-09-28T14:02:06.343Z
---
# 任务注册表（Tasks）— 2026-09-28-remove-liveness-overview-card

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 工作区详情页不再渲染 Agent 状态总览卡片
- [x] task-02: agent-liveness-overview-card.tsx 组件文件删除且无残留 import
- [x] task-03: page.test.tsx 清理对应 mock 后工作区详情页测试通过
- [x] task-04: 会话列表活性链路（use-session-liveness / liveness-badge）不受影响
