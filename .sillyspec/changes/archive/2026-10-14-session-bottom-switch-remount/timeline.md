# 合成时间线快照 — 2026-10-14-session-bottom-switch-remount

> 烤制于归档链（2026-10-14T08:10:09.882Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻为顺序推断（≈）。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-14-session-bottom-switch-remount — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
15:50:47  🁢 变更诞生（工件 frontmatter created_at）
15:50:50  📄 design.md 出现
15:50:50  📄 tasks.md 出现
15:56:23  📝 requirements.md 内容变更
15:56:23  📝 design.md 内容变更
15:56:23  📝 tasks.md 内容变更
15:56:23  ✅ checked 0→4
15:56:23  🔀 930a777fd  fix(sessions): TurnTimeline 挂载点 key=会话标识——SPA 列表切换会话不重挂…
16:08:43  📝 design.md 内容变更
16:08:43  🔀 d3ece657c  fix(sessions): 审查 P2 补口——AgentReplayBody 挂载点同款 key=会话标识…
16:10:07  · 门实测 passed（81.3s） · 20261014081006

── 任务面（勾选时刻 ≈ 顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  ≈15:56:23   TurnTimeline 挂载点带 key=会话标识——切换会话时组件重挂载，全部滚动…  930a777fd
task-02  ≈15:56:23   整页加载路径行为不变（重挂载对冷加载无差异）                        930a777fd
task-03  ≈15:56:23   切换会话后落底：上滚会话 A → 切换到长会话 → 落底（真浏览器实测 3/3）      930a777fd
task-04  ≈15:56:23   既有测试面复跑绿 + tsc 0                              930a777fd

墙钟：19min｜事件 10 条｜提交 2｜任务 4/4 勾选
阶段墙钟：design 17min｜tasks 5min｜requirements 0s｜verify 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻为顺序推断（事件不记任务 id）；描述行含机器稿截断。