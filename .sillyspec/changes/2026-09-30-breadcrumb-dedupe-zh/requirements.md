---
author: flow-machine-draft
created_at: 2026-09-30T08:05:20.453Z
---
# 需求规格（Requirements）— 2026-09-30-breadcrumb-dedupe-zh

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 变更中心列表页页头不再渲染 multi-agent-platform / 变更中心 页内面包屑
Given 系统就绪
When 变更中心列表页页头不再渲染 multi-agent-platform / 变更中心 页内面包屑
Then 行为符合本条标准描述

### FR-02: 任务详情页不再渲染 变更中心/changeKey/任务看板/task_key 页内面包屑
Given 系统就绪
When 任务详情页不再渲染 变更中心/changeKey/任务看板/task_key 页内面包屑
Then 行为符合本条标准描述

### FR-03: 顶栏面包屑路由段名全部映射为中文（changes→变更中心 等，MCP/Git/API 等专业术语除
Given api 相关模块就绪
When 顶栏面包屑路由段名全部映射为中文（changes
Then 变更中心 等，MCP/Git/API 等专业术语除外）

### FR-04: 段名中文标签与侧边栏菜单/工作区页签既有命名一致，不新造叫法
Given 系统就绪
When 段名中文标签与侧边栏菜单/工作区页签既有命名一致，不新造叫法
Then 行为符合本条标准描述

### FR-05: 受影响测试通过（仅跑相关测试，不跑全量）
Given 测试 相关模块就绪
When 受影响测试通过（仅跑相关测试，不跑全量）
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx 全套 39 用例（页头移除面包屑后页行为回归——含「卡片区可见入口指向变更中心路由」等页头/工具条行为）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：任务详情页（changes/[cid]/tasks/[tid]/page.tsx）仓内无既有测试文件，本次为纯静态 JSX 块删除，由 tsc --noEmit（通过）与页面其余 Link 行为不变守护；新增测试面超出 thin 范围

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/__tests__/top-bar.test.tsx「buildBreadcrumbs 段名中文化」describe 4 组用例（工作区子路由映射/深路由动态段透传/设置与 PPM 子页/根路径回归）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/__tests__/top-bar.test.tsx「buildBreadcrumbs 段名中文化」断言值逐一取自 menu-permissions.ts menuLabel 与 workspace-tabs.tsx label（变更中心/方案文件/Git 日志/MCP 令牌/知识库/API 密钥/我的供应商/菜单管理/个人工作台/个人中心）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/__tests__/top-bar.test.tsx + frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx + frontend/src/components/primer/__tests__/primer-structures.test.tsx 共 61 用例 vitest 全绿（2026-09-30 16:07 本地实测）+ tsc --noEmit 通过
