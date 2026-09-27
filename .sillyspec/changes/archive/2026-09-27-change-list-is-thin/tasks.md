---
author: flow-machine-draft
created_at: 2026-09-27T09:00:33.252Z
---
# 任务注册表（Tasks）— 2026-09-27-change-list-is-thin

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: ChangeSummary 含 is_thin（bool，default False 零破坏），后端投影测试覆盖三分支+时间窗负向
- [ ] task-02: 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行显示「轻量」琥珀徽章，归档轻量与已归档状态并存
- [ ] task-03: 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
- [ ] task-04: 部署后浏览器验证归档区轻量行出身标识
