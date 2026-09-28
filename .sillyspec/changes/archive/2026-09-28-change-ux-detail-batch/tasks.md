---
author: flow-machine-draft
created_at: 2026-09-28T09:04:42.689Z
---
# 任务注册表（Tasks）— 2026-09-28-change-ux-detail-batch

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 列表行描述 min-w-0 修复（flex 项 min-width:auto 陷阱，truncate 生效不再覆盖右列/影响模块）
- [x] task-02: 详情页头部描述行（w-full+truncate+悬浮全文）
- [x] task-03: 平台同步收进工具条按钮 + Drawer（drawerHint 中性提示；无绑定不再空白抽屉）
- [x] task-04: ChangeStageActions thin 长文案卡退役（return null，出身拦截保留；顶部轻量流程条不动）
- [x] task-05: 沉淀资产默认展开 + 移主栏 + md 两列网格 h-64 固定高度组内滚动
- [x] task-06: 智能体运行状态卡自桌面详情页移除（agentStatus 取数链一并退役；组件+测试保留供移动端）
- [x] task-07: 关联快速任务空列表静默隐藏（加载中/失败/空三态均不渲染）
- [x] task-08: scope-audit 卡去说明副标题 + 降级双段压单行（degraded-scope testid 退役，归档指路保留）
- [x] task-09: 测试随行为更新（assets 23P 含默认展开新钉子/stage-actions 反向钉/详情页 41P/列表页含抽屉钉子）——受影响面 30 文件 370P 全绿，tsc 0 错，eslint 0 错（3 warning 为预存债，较 HEAD 还少 1）
