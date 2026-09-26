---
author: flow-machine-draft
created_at: 2026-09-26T07:51:57.084Z
---
# 提案书（Proposal）— 2026-09-26-change-real-timeline

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:e81530b33ea370e9d887eb9be7bc8966dbb715aebf2e625d55632356234719e8:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-real-timeline 留痕重锚 -->
任务原话转写：动机:thin 轻量变更进度不落 sillyspec.db,平台详情页 steps 恒空、步骤时间线整块不渲染,主线叙事空窗;而 sillyspec 已有正式命令 watcher timeline --change 渲染真实留痕合成时间线(事件流 × tasks.md × git 提交锚),且事件流已推平台 platform_change_events 表——平台侧复刻该合成展示。

成功标准:
- 后端新增 GET /workspaces/{ws}/changes/{cid}/timeline 只读聚合端点:事件轴(platform_change_events 按 change_key 正序,requirements 工件 created_at 作诞生锚)、任务面(tasks.md 任务行含勾选态与描述,提交锚=事件 commit 短哈希经 git_log list_commits best-effort 反查标题,失败降级仅哈希)、脚注统计(墙钟/事件数/提交数/勾选比)
- 事件 kind 渲染对齐 CLI watcher timeline 的中文与图标语义(内容变更/勾选变化/fake-check 告警/提交/归档/诞生)
- 前端新增 ChangeTimelineCard 组件(自取数轮询,事件时间轴+任务面+脚注三段式),挂载于详情页 steps 为空处填补空窗;steps 有数据时维持原步骤时间线不动
- 后端聚焦测试覆盖聚合金样本、空 events 容错、git 标题降级;前端组件测试覆盖三段渲染与空态;聚焦测试全绿
- 规则 21:新端点 DTO 落 schema 后跑 pnpm gen:types 随提交 openapi.json 与 api-types.ts;frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:63cef56c6d645076370ee2fd84a780d0c6b5a62d9967722c766238de5bb207f1:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-real-timeline 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. 后端新增 GET /workspaces/{ws}/changes/{cid}/timeline 只读聚合端点:事件轴(platform_change_events 按 change_key 正序,requirements 工件 created_at 作诞生锚)、任务面(tasks.md 任务行含勾选态与描述,提交锚=事件 commit 短哈希经 git_log list_commits best-effort 反查标题,失败降级仅哈希)、脚注统计(墙钟/事件数/提交数/勾选比)
2. 事件 kind 渲染对齐 CLI watcher timeline 的中文与图标语义(内容变更/勾选变化/fake-check 告警/提交/归档/诞生)
3. 前端新增 ChangeTimelineCard 组件(自取数轮询,事件时间轴+任务面+脚注三段式),挂载于详情页 steps 为空处填补空窗
4. steps 有数据时维持原步骤时间线不动
5. 后端聚焦测试覆盖聚合金样本、空 events 容错、git 标题降级
6. 前端组件测试覆盖三段渲染与空态
7. 聚焦测试全绿
8. 规则 21:新端点 DTO 落 schema 后跑 pnpm gen:types 随提交 openapi.json 与 api-types.ts
9. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:5d18fbda49322eae586e75fe946a749d70602751d3cdb17232e81c67e2fd4bf4:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-real-timeline 留痕重锚 -->
1. 后端新增 GET /workspaces/{ws}/changes/{cid}/timeline 只读聚合端点:事件轴(platform_change_events 按 change_key 正序,requirements 工件 created_at 作诞生锚)、任务面(tasks.md 任务行含勾选态与描述,提交锚=事件 commit 短哈希经 git_log list_commits best-effort 反查标题,失败降级仅哈希)、脚注统计(墙钟/事件数/提交数/勾选比)
2. 事件 kind 渲染对齐 CLI watcher timeline 的中文与图标语义(内容变更/勾选变化/fake-check 告警/提交/归档/诞生)
3. 前端新增 ChangeTimelineCard 组件(自取数轮询,事件时间轴+任务面+脚注三段式),挂载于详情页 steps 为空处填补空窗
4. steps 有数据时维持原步骤时间线不动
5. 后端聚焦测试覆盖聚合金样本、空 events 容错、git 标题降级
6. 前端组件测试覆盖三段渲染与空态
7. 聚焦测试全绿
8. 规则 21:新端点 DTO 落 schema 后跑 pnpm gen:types 随提交 openapi.json 与 api-types.ts
9. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
