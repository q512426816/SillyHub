---
author: flow-machine-draft
created_at: 2026-09-26T07:51:57.085Z
---
# 需求规格（Requirements）— 2026-09-26-change-real-timeline

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
<!-- 参考摘录 5 条按实现结构重组为 FR-01~04 -->

### FR-01: 合成时间线聚合端点
Given thin 轻量变更进度不落库、steps 恒空、CLI 已有 watcher timeline 正式命令且事件流已推平台表，
When 客户端请求 GET /workspaces/{ws}/changes/{cid}/timeline，
Then 返回三段式合成数据——事件轴（platform_change_events 按 change_key 正序 + requirements 工件 created_at 作诞生锚）、任务面（tasks.md 任务行的勾选态/描述/提交锚，提交锚 = commit 事件短哈希经 git_log list_commits best-effort 前缀匹配标题，daemon 不可用降级仅哈希）、脚注统计（墙钟/事件数/提交数/勾选比）；变更不存在或跨工作区 → 404（对齐 assets 端点口径）。

### FR-02: 事件 kind 渲染对齐 CLI 语义
Given watcher 事件 kind 为英文机器值（file-update/task-done/warning/commit/archived），
When 前端渲染事件轴，
Then 每条事件显示时刻 + 图标 + 中文标签（内容变更/勾选变化/告警/提交/归档/诞生，语义对齐 CLI watcher timeline 输出），warning(rule=fake-check) 行醒目呈现（红/琥珀强调），provisional 角标提示观测语义。

### FR-03: 详情页空窗填补
Given 变更 steps 为空（thin 恒空、quick 存量同空），
When 详情页主线渲染，
When 原步骤时间线位置挂载 ChangeTimelineCard（自取数轮询、失败静默隐藏），三段式展示事件轴 + 任务面 + 脚注；steps 有数据时维持原步骤时间线不动（零回归）。

### FR-04: 测试与类型门禁全绿
Given 三处改动落盘，
When 运行后端聚焦测试（聚合金样本含诞生锚/任务行解析/提交标题匹配、空 events 容错、git 降级三面）与前端组件测试（三段渲染 + 空态 + steps 有数据不挂载）及 gen:types 后 tsc，
Then 全部通过、openapi.json 与 api-types.ts 随提交同步、0 类型错误。



## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_timeline.py::金样本聚合（诞生锚+事件轴+任务面+脚注） 与 ::空 events 容错 与 ::跨工作区 404 三用例

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx::事件轴中文标签与 fake-check 醒目 用例

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx 既有钉子回归（steps 空挂 timeline 卡断言可并入该文件或组件测试；steps 有数据走原时间线由 page-team-toggle 既有断言承担）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend uv run pytest app/modules/change/tests/test_timeline.py 全绿 + 前端聚焦套件一次跑过 + pnpm gen:types 幂等 + tsc exit 0（2026-09-26 实测）
