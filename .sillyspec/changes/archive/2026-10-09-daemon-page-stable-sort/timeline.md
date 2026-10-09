# 合成时间线快照 — 2026-10-09-daemon-page-stable-sort

> 烤制于归档链（2026-10-09T15:21:02.299Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻为顺序推断（≈）。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-09-daemon-page-stable-sort — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
23:01:05  🁢 变更诞生（工件 frontmatter created_at）
23:11:22  ✅ checked 0→1
23:11:22  ✅ checked 1→2
23:11:22  ✅ checked 2→3
23:11:22  ✅ checked 3→4

── 任务面（勾选时刻 ≈ 顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  ≈23:11:22   改 runtime/service.py list_machines 主查询排序：on…  无提交锚⚠️
task-02  ≈23:11:22   改 list_machines 嵌套 runtimes 二次查询：`provider`…  无提交锚⚠️
task-03  ≈23:11:22   改 grants/queries.py list_machines_shared_to…  无提交锚⚠️
task-04  ≈23:11:22   测试收口：改写 test_machines_sort_online_first_the…  无提交锚⚠️

墙钟：10min｜事件 4 条｜提交 0｜任务 4/4 勾选
阶段墙钟：tasks 1s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻为顺序推断（事件不记任务 id）；描述行含机器稿截断。