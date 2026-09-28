---
author: flow-machine-draft
created_at: 2026-09-28T14:11:55.606Z
---
# 任务注册表（Tasks）— 2026-09-28-fr-review-batch

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 试点 lib-knowledge 5 条全流程（2 confirm + 2 悬空重绑 .ts→.tsx + 1 无测试面清标记），命令链验证通过（提交 2f29e2693）
- [x] task-02: 波 1 复核 lib-api 64（11 confirm + 43 新绑 + 10 无测试面）+ daemon 56（11 confirm + 43 新绑 + 2 无测试面）+ frontend 31（9 confirm 含主会话补 2 条后端 .py 证据 + 6 重绑 + 11 新绑 + 5 无测试面）（提交 529f34e40 / 473c0b311）
- [x] task-03: 波 2 复核 lib-changes 31（7 confirm + 14 新绑 + 6 无测试面 + 4 废弃 + 1 修正）+ build 28（15 新绑 + 8 无测试面 + 5 废弃 + 3 修正）+ backend 23（17 confirm + 2 新绑 + 3 无测试面 + 1 修正）（提交 b9f40ac17 / 4d34ed131 / c23caca58）
- [x] task-04: 波 3 复核 components-shared 15（5 confirm + 9 新绑 + 1 无测试面 + 3 锚点修正）+ styles 7（5 新绑 + 2 无测试面 + 1 修正，dark 主题实证活跃不废弃）（提交 1fcb24f5b / 310cc5382）
- [x] task-05: 每波后 knowledge validate 无 errors（各域提交前均跑，全绿）+ 显式 pathspec 分波提交 8 笔（每笔标题带 task-NN）
- [x] task-06: 守恒核对通过——九域标记残留 0、260 = 62 confirm + 8 重绑 + 142 新绑 + 38 无测试面 + 9 废弃 + 1 纯修正；agent 绑定行 220（本次 212 + backend 存量 8）；新增 superseded 恰 9；范围外 candidate 123 行未动
