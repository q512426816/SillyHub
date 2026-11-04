# 合成时间线快照 — 2026-11-05-knowledge-vector-async-refresh

> 烤制于归档链（2026-11-04T17:06:50.470Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻：精确=task tick 侧车留痕，≈=事件流顺序推断。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-11-05-knowledge-vector-async-refresh — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
00:40:01  🁢 变更诞生（工件 frontmatter created_at）
00:40:11  📄 proposal.md 出现
00:40:11  📄 requirements.md 出现
00:40:11  📄 design.md 出现
00:40:11  📄 tasks.md 出现
00:41:03  📝 requirements.md 内容变更
00:41:52  📝 design.md 内容变更
00:42:12  📝 tasks.md 内容变更
00:42:25  📝 design.md 内容变更
00:43:22  ⚠️ scope-drift  声明面之外的代码文件被改：ackend/app/modules/knowledge/vector_search.py——范围漂…
00:45:03  ⚠️ scope-drift  声明面之外的代码文件被改：ackend/app/modules/knowledge/schema.py——范围漂移嫌疑（并行会…
00:45:40  ⚠️ scope-drift  声明面之外的代码文件被改：ackend/Dockerfile——范围漂移嫌疑（并行会话改动/越界，人判）
00:48:11  📝 design.md 内容变更
00:50:22  ⚠️ scope-drift  声明面之外的代码文件被改：backend/app/modules/knowledge/tests/test_embedding…
00:53:41  📝 tasks.md 内容变更
00:53:41  ✅ checked 0→6
00:53:49  ⚠️ scope-drift  声明面之外的代码文件被改：backend/Dockerfile——范围漂移嫌疑（并行会话改动/越界，人判）
00:55:08  🔀 4aa5ff094  feat(knowledge): CLI 向量检索端点读路径去嵌入化——冷启动请求分钟级挂起根治（生产实证 2…
00:55:16  ⚠️ scope-drift  声明面之外的代码文件被改：sillyspec/changes/2026-11-05-knowledge-vector-asyn…
00:55:46  · 门实测 passed（17.4s） · 20261104165545
01:03:42  ⚠️ scope-drift  声明面之外的代码文件被改：backend/Dockerfile——范围漂移嫌疑（并行会话改动/越界，人判）
01:04:09  ⚠️ scope-drift  声明面之外的代码文件被改：backend/app/modules/knowledge/tests/test_embedding…
01:04:45  🔀 4adef41de  fix(knowledge): 评审 P3 双清偿——embed 锁等待计入 timeout_sec 总预算（…

── 任务面（勾选时刻：精确=task tick 侧车留痕｜≈=事件流顺序推断｜tasks.md 描述行 × 提交锚）──
task-01  ≈00:53:41   vector_search.py 检索主体分流重构——search_sync 改只读判…  4aa5ff094
task-02  ≈00:53:41   禁建库开关门控——`knowledge_search_server_build=Fal…  无提交锚⚠️
task-03  ≈00:53:41   查询嵌入限时——EmbeddingSubprocessProxy.embed 增 ke…  无提交锚⚠️
task-04  ≈00:53:41   契约透传——schema.py VectorSearchOut 增 `index_sy…  无提交锚⚠️
task-05  ≈00:53:41   Dockerfile 预烤 bge-small-zh-v1.5——builder 段 …  无提交锚⚠️
task-06  ≈00:53:41   既有测试面等价迁移——指纹缓存/分批形状/小语料单批/排序 limit 契约/fail…  无提交锚⚠️

墙钟：24min｜事件 22 条｜提交 2｜任务 6/6 勾选
阶段墙钟：proposal 0s｜requirements 51s｜design 8min｜tasks 13min｜verify 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻精确值=task tick 侧车留痕（task-ticks.jsonl），≈=事件流顺序推断（事件不记任务 id）；描述行含机器稿截断。