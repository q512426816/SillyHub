---
author: flow-machine-draft
created_at: 2026-09-27T09:43:47.554Z
---
# 需求规格（Requirements）— 2026-09-27-knowledge-governance-cards

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: backend knowledge 模块新增 GET /workspaces/{ws}/knowle
Given 系统就绪
When backend knowledge 模块新增 GET /workspaces/{ws}/knowledge/governance（KNOWLEDGE_READ）
Then 行为符合本条标准描述

### FR-02: frontend 知识 tab 顶部新增治理信号卡区：healthy 一行安语、超阈逐卡（kind/
Given 系统就绪
When frontend 知识 tab 顶部新增治理信号卡区：healthy 一行安语、超阈逐卡（kind/计数/明细/处置指引——CLI 命令文案）
Then 行为符合本条标准描述

### FR-03: 取数走既有 api 模式（react-query）
Given api 相关模块就绪
When 取数走既有 api 模式（react-query）
Then 行为符合本条标准描述

### FR-04: pytest 覆盖端点（三类信号 fixture + 阈内 healthy + 权限）+ vites
Given 端点 / 组件 / 测试 相关模块就绪
When pytest 覆盖端点（三类信号 fixture + 阈内 healthy + 权限）+ vitest 组件测试（渲染/healthy/计数）
Then 行为符合本条标准描述

### FR-05: 显式 pathspec 提交，不夹带并行会话 staged 面
Given 系统就绪
When 显式 pathspec 提交，不夹带并行会话 staged 面
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
