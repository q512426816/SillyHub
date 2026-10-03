# 合成时间线快照 — 2026-10-03-local-usage-caliber-fix

> 烤制于归档链（2026-10-03T06:03:44.539Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻为顺序推断（≈）。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-03-local-usage-caliber-fix — 合成时间线（thick｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
13:43:23  🁢 变更诞生（工件 frontmatter created_at）
13:54:18  📝 design.md 内容变更
13:54:57  · 门实测 passed（29.2s） · 20261003055455
13:57:06  · 门实测 passed（29.2s） · 20261003055703
13:57:35  📝 requirements.md 内容变更

── 任务面（勾选时刻 ≈ 顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  未勾          摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输…  —
task-02  未勾          注释锚定 113/113 实证                               —
task-03  未勾          命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）       —
task-04  未勾          本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_s…  —
task-05  未勾          混合场景与 run 段取 MIN/MAX、耗时相加                     —
task-06  未勾          请求次数：本地段 SUM(invocations) 并入 api_requests     —
task-07  未勾          注脚声明口径（输入=非缓存输入                               —
task-08  未勾          时间为上报观察跨度                                     —
task-09  未勾          请求次数含 CLI 计数）                                 —
task-10  未勾          轮次维持 0（无来源）                                   —
task-11  未勾          覆盖写幂等使活跃日志下次上报自动重算                            —
task-12  未勾          聚焦测试全绿：test_usage_ingest + test_usage_stats…  —

墙钟：14min｜事件 4 条｜提交 0｜任务 0/12 勾选
阶段墙钟：design 0s｜verify 2min｜requirements 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻为顺序推断（事件不记任务 id）；描述行含机器稿截断。