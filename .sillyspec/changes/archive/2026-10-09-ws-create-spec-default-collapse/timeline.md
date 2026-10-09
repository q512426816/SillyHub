# 合成时间线快照 — 2026-10-09-ws-create-spec-default-collapse

> 烤制于归档链（2026-10-09T15:17:34.017Z）：事件流机本位（.runtime gitignore），本快照随归档包进 git 跨机可读。
> 末尾事件（含「目录已移入 archive」终拍）可能晚于烤制未入快照；勾选时刻为顺序推断（≈）。
> 原始事件副本：本目录 watcher-events.jsonl（时点快照）。
📅 2026-10-09-ws-create-spec-default-collapse — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）

── 事件时间轴 ──
22:58:49  🁢 变更诞生（工件 frontmatter created_at）
22:58:53  📄 proposal.md 出现
22:58:53  📄 requirements.md 出现
22:58:53  📄 design.md 出现
22:58:53  📄 tasks.md 出现
22:59:57  📝 requirements.md 内容变更
23:00:23  📝 design.md 内容变更
23:00:56  📝 tasks.md 内容变更
23:06:40  ⚠️ scope-drift  声明面之外的代码文件被改：ackend/app/modules/daemon/runtime/service.py——范围漂移…
23:07:01  ⚠️ scope-drift  声明面之外的代码文件被改：ackend/app/modules/daemon/grants/queries.py、backen…
23:08:03  ⚠️ scope-drift  声明面之外的代码文件被改：backend/app/modules/daemon/tests/test_machines_rou…
23:10:51  🔀 90e4be1c0  fix(daemon): /machines 机器列表排序固定——online 优先保留，last_heart…
23:10:51  ⚠️ scope-drift  声明面之外的代码文件被改：ackend/app/modules/daemon/grants/queries.py、backen…
23:11:01  🔀 2936faedf  fix(daemon): 嵌套 runtimes 与共享明细排序固定——provider 升序后追加 crea…
23:11:02  ⚠️ scope-drift  声明面之外的代码文件被改：ackend/app/modules/daemon/tests/test_machines_rout…
23:11:12  🔀 2723cc502  test(daemon): 排序稳定用例收口——旧 heartbeat 排序用例改写为展示名升序语义 + 机器…
23:11:12  ⚠️ scope-drift  声明面之外的代码文件被改：rontend/src/components/workspace-scan-dialog.tsx——…
23:11:35  🔀 d05aa105b  docs(spec): 2026-10-09-daemon-page-stable-sort 变更四件套（FR…
23:11:35  ⚠️ scope-drift  声明面之外的代码文件被改：rontend/src/app/m/workspaces/page.tsx——范围漂移嫌疑（并行会话…
23:15:26  📝 requirements.md 内容变更
23:15:50  ✅ checked 0→1
23:15:50  ✅ checked 1→2
23:15:50  ✅ checked 2→3
23:15:51  ✅ checked 3→4
23:15:52  📝 tasks.md 内容变更
23:15:52  ✅ checked 0→4
23:16:03  🔀 8561bb664  feat(frontend): 新建工作区 spec 策略默认 repo-native 并默认收起——桌面/移…
23:16:14  ✅ checked 4→5
23:16:15  ✅ checked 5→6
23:16:15  ✅ checked 6→7
23:16:17  📝 tasks.md 内容变更
23:16:17  ✅ checked 4→7
23:16:27  🔀 1c4acf7a8  test(frontend): 新建工作区 spec 策略默认收起新形态测试——桌面 2 用例（默认 repo…
23:17:04  📝 design.md 内容变更
23:17:25  · 门实测 passed（7.7s） · 20261009151723

── 任务面（勾选时刻 ≈ 顺序推断｜tasks.md 描述行 × 提交锚）──
（计数链中段断裂——断裂点后勾选时刻推断不可用，标 ?）
（已勾任务缺推断时刻——观测盲窗/水位丢失，标 ?）
task-01  ≈23:15:50   桌面端 workspace-scan-dialog.tsx：specStrategy …  90e4be1c0
task-02  ≈23:15:50   桌面端 spec 区块收起/展开交互：specExpanded state 默认 fa…  2936faedf
task-03  ≈23:15:50   移动端 m/workspaces/page.tsx：specStrategy 默认值与…  2936faedf
task-04  ≈23:15:51   移动端 WorkspaceCreateSheet 同款收起/展开交互（specExpa…  2723cc502
task-05  ?           桌面端测试 workspace-scan-dialog.test.tsx 新增用例：默…  1c4acf7a8
task-06  ?           移动端测试 page.m-workspaces.test.tsx 新增用例：默认 re…  1c4acf7a8
task-07  ?           回归验证：跑两端上述两个测试文件全量用例确认无既有用例挂（不跑全仓测试）——验证：两文…  1c4acf7a8

墙钟：18min｜事件 34 条｜提交 6｜任务 7/7 勾选
阶段墙钟：proposal 0s｜requirements 16min｜design 18min｜tasks 17min｜verify 0s
注：观测起点≠诞生时刻（watcher 后拉起/单飞锁盲窗）；勾选时刻为顺序推断（事件不记任务 id）；描述行含机器稿截断。