---
author: flow-machine-draft
created_at: 2026-09-28T13:37:18.188Z
---
# 需求规格（Requirements）— 2026-09-28-knowledge-inbox-clear

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: uncategorized.md 全部条目迁出，文件仅保留收件箱头注与清账说明
Given 系统就绪
When uncategorized.md 全部条目迁出，文件仅保留收件箱头注与清账说明
Then 行为符合本条标准描述

### FR-02: 每条按内容归入 known-issues / patterns / conventions / te
Given 系统就绪
When 每条按内容归入 known-issues / patterns / conventions / testing-gotchas / sillyspec-gotc
Then 行为符合本条标准描述

### FR-03: 已修复项按 known-issues 既有惯例标题带状态标记（已修复），未修复或现状认知项标记为待关
Given 系统就绪
When 已修复项按 known-issues 既有惯例标题带状态标记（已修复），未修复或现状认知项标记为待关注
Then 行为符合本条标准描述

### FR-04: 丢失标题的 SSE 路由条目补写标题后归入 FastAPI 路由顺序同族条目
Given api 相关模块就绪
When 丢失标题的 SSE 路由条目补写标题后归入 FastAPI 路由顺序同族条目
Then 行为符合本条标准描述

### FR-05: INDEX.md 五个分类节补齐迁移条目索引行，Uncategorized 节改为已清空说明，索引锚
Given 迁移 相关模块就绪
When INDEX.md 五个分类节补齐迁移条目索引行，Uncategorized 节改为已清空说明，索引锚点可解析
Then 行为符合本条标准描述

### FR-06: known-issues.md 内指向 uncategorized 旧条目的交叉引用改为指向新位置
Given 系统就绪
When known-issues.md 内指向 uncategorized 旧条目的交叉引用改为指向新位置
Then 行为符合本条标准描述

### FR-07: sillyspec knowledge validate 无 errors
Given 系统就绪
When sillyspec knowledge validate 无 errors
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
