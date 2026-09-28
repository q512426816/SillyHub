---
author: flow-machine-draft
created_at: 2026-09-28T01:42:46.081Z
---
# 需求规格（Requirements）— 2026-09-28-drop-observation-card

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）
Given 系统就绪
When 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）
Then 行为符合本条标准描述

### FR-02: 卡组件与其前端封装若无其他引用则一并删除（不留死代码）
Given 组件 / 前端 相关模块就绪
When 卡组件与其前端封装若无其他引用
Then 一并删除（不留死代码）

### FR-03: 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过
Given 测试 相关模块就绪
When 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过
Then 行为符合本条标准描述

### FR-04: 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）
Given 端点 相关模块就绪
When 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx :: FR-01：aside 挂载沉淀资产卡；观测事件卡已移除（2026-09-28-drop-observation-card 反向钉）——queryByTestId change-observation-events-card 为 null

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend 全仓 tsc --noEmit 0 错（删除文件与引用净尽否则模块解析报错）；全仓 rg 无 ChangeObservationEventsCard/ChangeEventsCard/listChangeEvents 残余引用

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
详情页域 128 用例全过（page-restore-assets 9 / page-team-toggle 13 / page-last-signal 5 / detail 组件套件含 change-timeline-card 4 / change-assets-card 等）；ESLint 0 警告

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：后端零改动（GET /changes/{name}/events 端点与 platform_change_events 表原样保留，CLI watcher 推送链路无触碰——无测试面需求；既有后端 platform_sync 套件未动）
