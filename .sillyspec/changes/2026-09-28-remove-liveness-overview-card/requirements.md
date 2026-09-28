---
author: flow-machine-draft
created_at: 2026-09-28T14:02:06.342Z
---
# 需求规格（Requirements）— 2026-09-28-remove-liveness-overview-card

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 工作区详情页不再渲染 Agent 状态总览卡片
Given 系统就绪
When 工作区详情页不再渲染 Agent 状态总览卡片
Then 行为符合本条标准描述

### FR-02: agent-liveness-overview-card.tsx 组件文件删除且无残留 import
Given 组件 相关模块就绪
When agent-liveness-overview-card.tsx 组件文件删除且无残留 import
Then 行为符合本条标准描述

### FR-03: page.test.tsx 清理对应 mock 后工作区详情页测试通过
Given 测试 相关模块就绪
When page.test.tsx 清理对应 mock 后工作区详情页测试通过
Then 行为符合本条标准描述

### FR-04: 会话列表活性链路（use-session-liveness / liveness-badge）不受影
Given 系统就绪
When 会话列表活性链路（use-session-liveness / liveness-badge）不受影响
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
