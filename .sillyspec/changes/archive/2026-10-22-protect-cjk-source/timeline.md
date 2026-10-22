# 合成时间线快照 — 2026-10-22-protect-cjk-source

> 烤制于归档链（2026-10-22T02:51:00.855Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻：精确=task tick 侧车留痕，≈=事件流顺序推断。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-22-protect-cjk-source — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
10:40:09  🁢 变更诞生（工件 frontmatter created_at）
10:40:13  📄 proposal.md 出现
10:40:13  📄 requirements.md 出现
10:40:13  📄 design.md 出现
10:40:13  📄 tasks.md 出现
10:40:32  📝 requirements.md 内容变更
10:40:35  📝 design.md 内容变更
10:40:39  📝 tasks.md 内容变更
10:42:21  🔀 9d196ae6e  fix(frontend): 评审 P1/P3 修复——混列队列拖拽重排静默失效（P1）：handleRowD…
10:44:09  ✅ checked 0→1
10:44:10  ✅ checked 1→2
10:44:10  ✅ checked 2→3
10:44:11  📝 tasks.md 内容变更
10:44:11  ✅ checked 0→3
10:44:25  🔀 27a0d2331  fix(translate): 源端中文片段保护——汉字与中文/全角标点同代码/URL 不送翻，杜绝 opus…
10:45:05  · 门实测 passed（13.3s） · 20261022024503
10:50:48  🔀 e5dce012e  docs(translate): 评审 P2/P3 清偿——模块 docstring 与 SourceSegm…
10:50:59  📄 decisions.md 出现

── 任务面（勾选时刻：精确=task tick 侧车留痕｜≈=事件流顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  10:44:09    chunking.py 的 _PROTECT_RE 增加中文片段保护分支（汉字 + 中…  无提交锚⚠️
task-02  10:44:10    test_service.py 新增生产复现用例（中文引用逐字保留 + 输出无连续反斜…  无提交锚⚠️
task-03  10:44:10    README 同步源端中文保护说明；生产容器用修复后代码复跑复现脚本验证无反斜杠乱码    无提交锚⚠️

墙钟：10min｜事件 17 条｜提交 3｜任务 3/3 勾选
阶段墙钟：proposal 10min｜requirements 19s｜design 23s｜tasks 3min｜verify 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻精确值=task tick 侧车留痕（task-ticks.jsonl），≈=事件流顺序推断（事件不记任务 id）；描述行含机器稿截断。