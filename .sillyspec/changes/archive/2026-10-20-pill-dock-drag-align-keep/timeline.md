# 合成时间线快照 — 2026-10-20-pill-dock-drag-align-keep

> 烤制于归档链（2026-10-20T01:24:35.060Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻：精确=task tick 侧车留痕，≈=事件流顺序推断。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-20-pill-dock-drag-align-keep — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
09:13:17  🁢 变更诞生（工件 frontmatter created_at）
09:13:25  📄 tasks.md 出现
09:13:56  📝 requirements.md 内容变更
09:14:13  📝 design.md 内容变更
09:14:13  ⚠️ scope-drift  声明面之外的代码文件被改：deploy/models/——范围漂移嫌疑（并行会话改动/越界，人判）
09:17:30  ⚠️ scope-drift  声明面之外的代码文件被改：rontend/src/components/daemon/session-floating-pil…
09:17:52  ⚠️ scope-drift  声明面之外的代码文件被改：rontend/src/components/daemon/__tests__/session-fl…
09:19:21  ✅ checked 0→1
09:19:22  ✅ checked 1→2
09:19:23  📝 tasks.md 内容变更
09:19:23  ✅ checked 0→2
09:19:23  ✅ checked 2→3
09:19:26  📝 tasks.md 内容变更
09:19:26  ✅ checked 2→3
09:19:36  🔀 7b435cd56  fix(session-panel): 悬浮 pill 停靠组拖拽过程中保持拖拽前对齐——clampPos 透…
09:19:40  ⚠️ scope-drift  声明面之外的代码文件被改：sillyspec/changes/2026-10-20-pill-dock-drag-align-…
09:20:10  · 门实测 passed（3.8s） · 20261020012009
09:20:55  🔀 4f77e50c1  chore(deploy): gitignore fastembed 模型运行时缓存——backend 容器重…
09:21:12  📝 design.md 内容变更

── 任务面（勾选时刻：精确=task tick 侧车留痕｜≈=事件流顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  09:19:21    左停靠的组拖拽过程中内容保持左对齐,不再翻回右对齐;右停靠同理保持右对齐          无提交锚⚠️
task-02  09:19:22    松手吸附后仍按吸附侧正确切换对齐(既有行为不变)                      无提交锚⚠️
task-03  09:19:23    dock 测试全绿(新增拖拽中对齐保持断言)                        无提交锚⚠️

墙钟：7min｜事件 18 条｜提交 2｜任务 3/3 勾选
阶段墙钟：tasks 6min｜requirements 0s｜design 6min｜verify 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻精确值=task tick 侧车留痕（task-ticks.jsonl），≈=事件流顺序推断（事件不记任务 id）；描述行含机器稿截断。