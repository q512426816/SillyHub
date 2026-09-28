---
author: flow-machine-draft
created_at: 2026-09-28T14:40:31.962Z
---
# 需求规格（Requirements）— 2026-09-28-change-detail-header-overflow

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破
Given 组件 相关模块就绪
When PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破头部宽度
Then 行为符合本条标准描述

### FR-02: 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth
Given 系统就绪
When 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth 等于视口宽（无横向滚动）
Then 行为符合本条标准描述

### FR-03: 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）
Given 系统就绪
When 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）
Then 行为符合本条标准描述

### FR-04: 相关前端测试与 tsc 通过
Given 前端 / 测试 相关模块就绪
When 相关前端测试与 tsc 通过
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
