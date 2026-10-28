# 合成时间线快照 — 2026-10-28-change-usage-attribution-window

> 烤制于归档链（2026-10-28T06:17:36.677Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻：精确=task tick 侧车留痕，≈=事件流顺序推断。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-28-change-usage-attribution-window — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
13:47:18  🁢 变更诞生（工件 frontmatter created_at）
13:47:22  📄 requirements.md 出现
13:47:22  📄 design.md 出现
13:47:22  📄 tasks.md 出现
14:05:35  📄 decisions.md 出现
14:06:51  📝 requirements.md 内容变更
14:07:31  📝 design.md 内容变更
14:07:38  📝 design.md 内容变更
14:13:46  ✅ checked 0→1
14:13:47  📝 tasks.md 内容变更
14:13:47  ✅ checked 0→1
14:13:52  ✅ checked 1→2
14:13:54  📝 tasks.md 内容变更
14:13:54  ✅ checked 1→2
14:13:57  ✅ checked 2→3
14:13:57  📝 tasks.md 内容变更
14:13:57  ✅ checked 2→3
14:14:01  ✅ checked 3→4
14:14:04  📝 tasks.md 内容变更
14:14:04  ✅ checked 3→4
14:14:05  ✅ checked 4→5
14:14:08  📝 tasks.md 内容变更
14:14:08  ✅ checked 4→5
14:14:10  ✅ checked 5→6
14:14:12  📝 tasks.md 内容变更
14:14:12  ✅ checked 5→6
14:14:15  ✅ checked 6→7
14:14:15  📝 tasks.md 内容变更
14:14:15  ✅ checked 6→7
14:14:19  ✅ checked 7→8
14:14:22  📝 tasks.md 内容变更
14:14:22  ✅ checked 7→8
14:16:09  🔀 81f085761  fix(change): 变更执行用量归因时间窗+终态清锚——修「新变更背绑定前历史账」(2026-10-28…

── 任务面（勾选时刻：精确=task tick 侧车留痕｜≈=事件流顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  14:13:46    linked 分支只认领 started_at 晚于该 (change, sessio…  81f085761
task-02  14:13:52    linked 分支窗口上界=变更 archived_at 与同会话下一变更 link …  无提交锚⚠️
task-03  14:13:57    单会话先后绑定多变更时无锚 run 只归「轮时刻最近绑定的变更」，不双计          无提交锚⚠️
task-04  14:14:01    同一变更绑定多会话时按各 link 行 created_at 独立开窗统计         无提交锚⚠️
task-05  14:14:05    dispatched 分支对已归档变更只统计 started_at 早于等于 arch…  无提交锚⚠️
task-06  14:14:10    轻量族命令 flow done 与全量族命令 run archive 触发终态时清除会…  无提交锚⚠️
task-07  14:14:15    存量虚高统计（如 2026-10-28-session-list-loadmore-f…  无提交锚⚠️
task-08  14:14:19    后端单测覆盖上述全部场景并通过，既有 usage_stats 测试回归不破         无提交锚⚠️

墙钟：28min｜事件 32 条｜提交 1｜任务 8/8 勾选
阶段墙钟：requirements 19min｜design 20min｜tasks 27min｜proposal 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻精确值=task tick 侧车留痕（task-ticks.jsonl），≈=事件流顺序推断（事件不记任务 id）；描述行含机器稿截断。