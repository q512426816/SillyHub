# 合成时间线快照 — 2026-10-14-session-bottom-grace-window

> 烤制于归档链（2026-10-15T02:27:14.661Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻为顺序推断（≈）。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-14-session-bottom-grace-window — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
10:08:56  🁢 变更诞生（工件 frontmatter created_at）
10:08:59  📄 requirements.md 出现
10:08:59  📄 design.md 出现
10:08:59  📄 tasks.md 出现
10:15:16  📝 requirements.md 内容变更
10:15:16  📝 design.md 内容变更
10:15:16  📝 tasks.md 内容变更
10:15:16  ✅ checked 0→4
10:15:24  🔀 3658ef811  fix(sessions): 贴底记忆宽限窗（第六层加固）——刷新落位随机的复现态特征锁定（scrollTop…
10:19:48  📝 design.md 内容变更
10:20:35  · 门实测 passed（46.1s） · 20261015022035
10:20:38  🔀 82b966f8f  chore(archive): 2026-10-14-session-bottom-grace-window …

── 任务面（勾选时刻 ≈ 顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  ≈10:15:16   RO 钉底条件扩为 isNearBottomRef ||（距最近贴底 <10s 且无用…  3658ef811
task-02  ≈10:15:16   用户真实滚动（滚轮/触摸/拖动）立即恢复既有让权语义（near=false 后不强拉）   3658ef811
task-03  ≈10:15:16   挂载即视为在窗内（初始加载全程受保护），超过 10s 或用户输入后回到既有语义       3658ef811
task-04  ≈10:15:16   既有测试面复跑绿 + tsc 0                              3658ef811

墙钟：11min｜事件 11 条｜提交 2｜任务 4/4 勾选
阶段墙钟：requirements 6min｜design 10min｜tasks 6min｜verify 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻为顺序推断（事件不记任务 id）；描述行含机器稿截断。