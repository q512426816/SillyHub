---
author: flow-machine-draft
created_at: 2026-09-27T05:52:55.219Z
---
# 任务注册表（Tasks）— 2026-09-27-thin-display-fix

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type=quick 或 steps 全无标准阶段痕迹）显示轻量流程…
- [ ] task-02: 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」
- [ ] task-03: 标题区影响字段空值时不渲染占位噪音
- [ ] task-04: 列表行 active thin（stage=thin）状态图标为琥珀闪电
- [ ] task-05: 判定函数导出+单测覆盖三分支
- [ ] task-06: 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
- [ ] task-07: 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_thin 投影——记入后续建议不在本刀）
