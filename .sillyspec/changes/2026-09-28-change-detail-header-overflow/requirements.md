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
- frontend/src/components/layout/__tests__/page-header.test.tsx · 「左侧内容列带 min-w-0——flex 项 min-width:auto 陷阱的组件级修复锚」

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/layout/__tests__/page-header.test.tsx · 「详情页同款长描述场景：truncate span 渲染在 min-w-0 列内（收缩链前置条件）」（jsdom 无布局引擎，几何断言由 Playwright 生产实测承担：修复前后 scrollWidth 2219→1600/1280 清零、省略号截断，证据见变更目录 visual-evidence.md A/B 节）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/layout/__tests__/page-header.test.tsx · 「基本结构：title 进 h1 / subtitle 进 p / actions 右侧槽」＋「详情页同款长描述场景」（标题 min-w-0 truncate 类名与收缩链结构断言；超长标题的布局几何同 FR-02 由 Playwright 生产实测覆盖）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/layout/__tests__/page-header.test.tsx · 全部 3 用例（3/3 绿）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx · 10 用例、page-last-signal.test.tsx · 5 用例、page-team-toggle.test.tsx · 13 用例（详情页受影响面 28/28 绿）
- tsc：frontend `pnpm exec tsc --noEmit` 0 错
