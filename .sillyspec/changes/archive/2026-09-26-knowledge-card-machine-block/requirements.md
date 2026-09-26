---
author: flow-machine-draft
created_at: 2026-09-26T11:47:46.140Z
---
# 需求规格（Requirements）— 2026-09-26-knowledge-card-machine-block

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 卡片视图不再把整行 HTML 注释当正文渲染（与原文视图口径一致：注释不可见）
Given 系统就绪
When 卡片视图不再把整行 HTML 注释当正文渲染（与原文视图口径一致：注释不可见）
Then 行为符合本条标准描述

### FR-02: 测试绑定机器块（注释标记 + row 行 + 缩进键值行）解析为结构化数据，以紧凑只读行展示 tes
Given 测试 相关模块就绪
When 测试绑定机器块（注释标记 + row 行 + 缩进键值行）解析为结构化数据，以紧凑只读行展示 tests 路径与 state，不再整块 YAML 倾泻
Then 行为符合本条标准描述

### FR-03: 机器块的「测试绑定：」空字段头不再以悬空空值字段行出现在字段网格
Given 测试 相关模块就绪
When 机器块的「测试绑定：」空字段头不再以悬空空值字段行出现在字段网格
Then 行为符合本条标准描述

### FR-04: 无机器块的既有条目（decisions/fr/手册）渲染零回归
Given 系统就绪
When 无机器块的既有条目（decisions/fr/手册）渲染零回归
Then 行为符合本条标准描述

### FR-05: 聚焦测试全绿 + tsc 0 错
Given 测试 相关模块就绪
When 聚焦测试全绿 + tsc 0 错
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「测试绑定机器块」describe 渲染用例（queryByText 勿手改/手写整行注释 均不可见）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「测试绑定机器块」describe 解析+渲染两用例（testBindings 结构、tests · candidate 紧凑行、title=rowId）


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「测试绑定机器块」解析用例（fields 无「测试绑定」空头）+渲染用例（queryByText("测试绑定：") 精确匹配为空）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx 既有 15 用例回归 + frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx 26 用例回归


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx 17 passed + knowledge-page 26 passed 实测；pnpm exec tsc --noEmit exit 0（本会话实跑）

