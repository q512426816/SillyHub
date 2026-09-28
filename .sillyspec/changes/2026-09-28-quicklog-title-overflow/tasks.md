---
author: flow-machine-draft
created_at: 2026-09-28T15:35:32.307Z
---
# 任务注册表（Tasks）— 2026-09-28-quicklog-title-overflow

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: quicklog-table.tsx DataTable 加 tableLayout="fixed"（auto 布局列宽协商致标题列分得宽度小于内容自适应宽而溢出压邻列）
- [x] task-02: 标题按钮 max-w-[420px] → block w-full min-w-0 max-w-[420px]（宽度跟随单元格，420 保留宽屏上限）
- [x] task-03: StatusColumn 外层 inline-flex → flex、备注 max-w-[160px] → max-w-full（130px 状态列同型隐患收口）
- [x] task-04: quicklog-table.test.tsx 追加 3 用例（fixed 布局内联样式锚 / 标题按钮类名锚 / 状态备注结构锚）19/19 绿 + tsc 0 错
