# 合成时间线快照 — 2026-10-17-session-envelope-rev-stale-guard

> 烤制于归档链（2026-10-17T13:23:33.549Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻：精确=task tick 侧车留痕，≈=事件流顺序推断。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-17-session-envelope-rev-stale-guard — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
21:14:59  🁢 变更诞生（工件 frontmatter created_at）
21:15:03  📄 design.md 出现
21:15:03  📄 tasks.md 出现
21:17:23  📝 requirements.md 内容变更
21:17:23  📝 design.md 内容变更
21:17:23  📝 tasks.md 内容变更
21:17:23  ✅ checked 0→5
21:17:24  ⚠️ scope-drift  声明面之外的代码文件被改：rontend/src/stores/session.test.ts——范围漂移嫌疑（并行会话改动/…
21:17:34  🔀 d375a86dc  fix(frontend): 会话信封单调 rev 防迟到旧值覆盖——setTokens/setUser/cl…
21:18:09  📝 design.md 内容变更
21:18:13  📝 requirements.md 内容变更
21:18:20  🔀 166ea374a  docs(spec): rev 防乱序变更工件补填——design 四节+文件清单+FR 测试绑定（2026-…
21:18:23  📝 design.md 内容变更
21:18:34  · 门实测 passed（3.2s） · 20261017131832

── 任务面（勾选时刻：精确=task tick 侧车留痕｜≈=事件流顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  ≈21:17:23   SessionState 新增单调 rev 计数器：setTokens/setUser…  d375a86dc
task-02  ≈21:17:23   回放守卫：远端信封 rev 严格小于本地 rev 时整体忽略（陈旧）；等于时走既有内容…  d375a86dc
task-03  ≈21:17:23   向后兼容：无 rev 字段的旧形状信封走既有内容比对路径，既有 6+3 用例语义不变    d375a86dc
task-04  ≈21:17:23   新增单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等值同内容静默、…  d375a86dc
task-05  ≈21:17:23   既有 token-refresh/session 测试不回归                d375a86dc

墙钟：3min｜事件 13 条｜提交 2｜任务 5/5 勾选
阶段墙钟：design 3min｜tasks 2min｜requirements 49s｜verify 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻精确值=task tick 侧车留痕（task-ticks.jsonl），≈=事件流顺序推断（事件不记任务 id）；描述行含机器稿截断。