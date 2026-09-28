---
author: flow-machine-draft
created_at: 2026-09-28T05:26:25.187Z
---
# 需求规格（Requirements）— change-list-description

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: Change 表新增 description 可空列（alembic 迁移），reparse 与文档
Given 迁移 相关模块就绪
When Change 表新增 description 可空列（alembic 迁移），reparse 与文档推送两条写路径同源提取不互翻
Then 行为符合本条标准描述

### FR-02: 提取规则：proposal.md 动机段首个非空段落，剥机器注释与「任务原话转写：」前缀、截到「成功
Given 系统就绪
When 提取规
Then ：proposal.md 动机段首个非空段落，剥机器注释与「任务原话转写：」前缀、截到「成功标准」行前，最长 500 字符

### FR-03: ChangeSummary
Given 系统就绪
When ChangeSummary
Then 行为符合本条标准描述

### FR-04: ChangeRead 带 description
Given 系统就绪
When ChangeRead 带 description
Then 行为符合本条标准描述

### FR-05: 列表搜索 ILIKE 同时命中 change_key/title/description
Given 系统就绪
When 列表搜索 ILIKE 同时命中 change_key/title/description
Then 行为符合本条标准描述

### FR-06: 变更中心列表（桌面与移动）行内展示描述（单行截断、悬浮全文），无描述行零占位
Given 系统就绪
When 变更中心列表（桌面与移动）行内展示描述（单行截断、悬浮全文），无描述行零占位
Then 行为符合本条标准描述

### FR-07: 相关 backend pytest 与 frontend 测试通过
Given 测试 相关模块就绪
When 相关 backend pytest 与 frontend 测试通过
Then 行为符合本条标准描述

### FR-08: api-types 由 pnpm gen:types 再生成并随变更提交
Given api 相关模块就绪
When api-types 由 pnpm gen:types 再生成并随变更提交
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

backend/app/modules/change/tests/test_title_normalization.py :: TestUpsertDocumentsDescription（列落库经两写路径断言）；迁移链 offline SQL 渲染验证（alembic upgrade 20260926234000:20260928140000 --sql）
<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

backend/app/modules/change/tests/test_title_normalization.py :: TestExtractDescription（thin 机器形态/完整流程散文/无动机段/全空/纯列表回退/500 截断 6 例）
<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

backend/app/modules/change/tests/test_title_normalization.py :: TestListSearchHitsDescription（summary 行经 list_ 读取）＋ TestUpsertDocumentsDescription（行字段回读）
<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

不适用：ChangeRead.description 与 ChangeSummary 同源 schema 字段（model_config from_attributes 同一路径），列表侧 TestListSearchHitsDescription 已覆盖读路径；详情端点无独立行为分支
<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

backend/app/modules/change/tests/test_title_normalization.py :: TestListSearchHitsDescription :: test_search_by_description（按描述词命中）
<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx :: 「变更行渲染描述（悬浮全文可读），无描述行零占位」；移动侧 frontend/src/components/mobile（MobileChangeCard 经 m/workspaces/[id]/changes 页面测试 41P 全绿渲染）
<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

backend/app/modules/change/tests/test_title_normalization.py（28P）＋ test_reparse_guard.py（13P）＋ change/platform_sync 模块 886P；frontend 桌面 changes 页 132P＋移动 41P＋tsc/eslint 0
<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

不适用：生成物工序（api-types.ts/openapi.json 再生成随交 f5269e9fc 提交面），无运行时行为可测；gen:types:check 守门 CI