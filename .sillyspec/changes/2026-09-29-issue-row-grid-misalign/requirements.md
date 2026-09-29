---
author: flow-machine-draft
created_at: 2026-09-29T00:49:55.976Z
---
# 需求规格（Requirements）— 2026-09-29-issue-row-grid-misalign

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1f
Given 系统就绪
When IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1fr/右列 auto），与 IssueRowHeader 占位
Then 行为符合本条标准描述

### FR-02: 修复后 unclear-req-to-brainstorm 行 desc span 与 step-s
Given 系统就绪
When 修复后 unclear-req-to-brainstorm 行 desc span 与 step-sub-row 包围盒交集为 false，desc 省略号截断
Then 行为符合本条标准描述

### FR-03: 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）
Given 系统就绪
When 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）
Then 行为符合本条标准描述

### FR-04: primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错
Given 测试 相关模块就绪
When primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错
Then 行为符合本条标准描述

### FR-05: 部署生产后同行复测交集 false + 列表全行扫描零叠压
Given 系统就绪
When 部署生产后同行复测交集 false + 列表全行扫描零叠压
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/primer/__tests__/primer-structures.test.tsx · 「leading 缺席渲染空占位——四子元素落设计轨道（2026-09-29-issue-row-grid-misalign）」

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- jsdom 无布局引擎，几何断言由机理 A/B 静态对照（grid-repro.html，无占位交集 true vs 有占位 false）+ 部署后生产同行复测承担（visual-evidence.md B/D 节）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- 同 FR-02（静态 A/B + 部署后生产扫描：右列每个可见文本元素左界 >= 右列容器盒左界）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/primer/__tests__/primer-structures.test.tsx · 13/13（含新增占位用例）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx · 39/39（消费方回归）
- tsc：frontend `pnpm exec tsc --noEmit` 0 错

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
