---
author: flow-machine-draft
created_at: 2026-09-28T10:17:49.917Z
---
# 提案书（Proposal）— 2026-09-28-timeline-anchor-scope

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:25345cff7e58b3009bca1b952bdac91249425f69f1baeb89d1b958cd31ec2280:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-timeline-anchor-scope 留痕重锚 -->
任务原话转写：背景：guidance-principles 变更时间线实证——任务面提交锚全部错指 4d84c48d（两天前另一变更的提交，消息恰好含 task-01 至 task-04）。根因：timeline.py _load_commit_window 用 GitLogService 拉全仓最新 50 提交构成锚窗口，任务锚在该全局窗口倒序匹配 task token——同名任务号跨变更撞车必然发生；正确窗口应是本变更自己的 commit 事件（rows 里 kind=commit 的短哈希集），它本来就是函数入参 shas。
成功标准：
- 任务锚窗口收窄：仅本变更 commit 事件的提交参与锚匹配（titles 映射仍可用全局 50 窗口取标题——那是展示用途与锚定无关）
- 全局窗口无本变更提交时锚为 None（显示无锚而非错锚）
- 前端事件行图标表补 gate-run、config-change、fake-check-cleared 三个新事件 kind（watcher-signal-widen 上游已发）
- 后端测试：锚定限本变更事件窗口（他变更提交含同号 token 不误锚）、无窗口提交时 None；前端卡片测试补三个新 kind 图标渲染
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:4bf34f000599cc7fb1b231cba847a1ab5483e1440463b56cd2a68e8365bdefed:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-timeline-anchor-scope 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 任务锚窗口收窄：仅本变更 commit 事件的提交参与锚匹配（titles 映射仍可用全局 50 窗口取标题——那是展示用途与锚定无关）
2. 全局窗口无本变更提交时锚为 None（显示无锚而非错锚）
3. 前端事件行图标表补 gate-run、config-change、fake-check-cleared 三个新事件 kind（watcher-signal-widen 上游已发）
4. 后端测试：锚定限本变更事件窗口（他变更提交含同号 token 不误锚）、无窗口提交时 None
5. 前端卡片测试补三个新 kind 图标渲染
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:89872ce4d9989e8ceecd574dc8a1a59be85b645302cb21c03cad20c74604f9ce:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-timeline-anchor-scope 留痕重锚 -->
1. 任务锚窗口收窄：仅本变更 commit 事件的提交参与锚匹配（titles 映射仍可用全局 50 窗口取标题——那是展示用途与锚定无关）
2. 全局窗口无本变更提交时锚为 None（显示无锚而非错锚）
3. 前端事件行图标表补 gate-run、config-change、fake-check-cleared 三个新事件 kind（watcher-signal-widen 上游已发）
4. 后端测试：锚定限本变更事件窗口（他变更提交含同号 token 不误锚）、无窗口提交时 None
5. 前端卡片测试补三个新 kind 图标渲染
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
