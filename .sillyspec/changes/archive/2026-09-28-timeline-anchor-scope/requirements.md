---
author: flow-machine-draft
created_at: 2026-09-28T10:17:49.919Z
---
# 需求规格（Requirements）— 2026-09-28-timeline-anchor-scope

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 任务锚窗口收窄：仅本变更 commit 事件的提交参与锚匹配（titles 映射仍可用全局 50 窗
Given 系统就绪
When 任务锚窗口收窄：仅本变更 commit 事件的提交参与锚匹配（titles 映射仍可用全局 50 窗口取标题——那是展示用途与锚定无关）
Then 行为符合本条标准描述

### FR-02: 全局窗口无本变更提交时锚为 None（显示无锚而非错锚）
Given 系统就绪
When 全局窗口无本变更提交时锚为 None（显示无锚而非错锚）
Then 行为符合本条标准描述

### FR-03: 前端事件行图标表补 gate-run、config-change、fake-check-cleare
Given 前端 相关模块就绪
When 前端事件行图标表补 gate-run、config-change、fake-check-cleared 三个新事件 kind（watcher-signal-wi
Then 行为符合本条标准描述

### FR-04: 后端测试：锚定限本变更事件窗口（他变更提交含同号 token 不误锚）、无窗口提交时 None
Given 测试 相关模块就绪
When 后端测试：锚定限本变更事件窗口（他变更提交含同号 token 不误锚）、无窗口提交时 None
Then 行为符合本条标准描述

### FR-05: 前端卡片测试补三个新 kind 图标渲染
Given 前端 / 测试 相关模块就绪
When 前端卡片测试补三个新 kind 图标渲染
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_timeline.py「test_task_anchor_scoped_to_change_commits」（bbb2222 同号 token 在窗口最前不抢锚，锚=aaa1111）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_timeline.py 同用例第二断言（task-02 无命中 → None）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx 全部 4 用例（icon fallback 机制由 eventIcon ?? 兜底覆盖）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_timeline.py 7/7 全绿（含既有金样本回归）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：API 契约零变化（TimelineTask.commit_sha 语义收窄由 FR-01/02 用例锁定；tsc/ruff/mypy 全过为类型面佐证）
