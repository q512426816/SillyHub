---
author: flow-machine-draft
created_at: 2026-09-28T01:46:04.845Z
---
# 需求规格（Requirements）— 2026-09-28-turn-nav-hover-flyout

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 默认 44px 窄轨：紧凑刻度+当前轮位置指示+顶部当前轮号，aria-label 保留（第N轮可达
Given 系统就绪
When 默认 44px 窄轨：紧凑刻度+当前轮位置指示+顶部当前轮号，aria-label 保留（第N轮可达性）
Then 行为符合本条标准描述

### FR-02: 悬停滑出完整行式列表浮层（覆盖聊天区不挤压布局，~260px），移开延迟收起
Given 系统就绪
When 悬停滑出完整行式列表浮层（覆盖聊天区不挤压布局，~260px），移开延迟收起
Then 行为符合本条标准描述

### FR-03: 点击窄轨可 pin 锁定，点外部收起
Given 系统就绪
When 点击窄轨可 pin 锁定，点外部收起
Then 行为符合本条标准描述

### FR-04: 触屏 hover:none 时点按展开收起
Given 系统就绪
When 触屏 hover:none 时点按展开收起
Then 行为符合本条标准描述

### FR-05: 浮层内保留全部既有功能：轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转（含未加载轮 run_id
Given 高亮 相关模块就绪
When 浮层内保留全部既有功能：轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转（含未加载轮 run_id 直达）
Then 行为符合本条标准描述

### FR-06: 既有测试改断言不改意图全绿，tsc
Given 测试 相关模块就绪
When 既有测试改断言不改意图全绿，tsc
Then 行为符合本条标准描述

### FR-07: eslint 零新增，主题 token 零硬编码
Given 系统就绪
When eslint 零新增，主题 token 零硬编码
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-01: `frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx`「entries < 3 → 整列不渲染…3 条起出现窄轨」+「刻度 aria-label…」+「把手显示当前轮号…aria-expanded」

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-02: 同文件「悬停 300ms 防抖滑出浮层…」「pin 锁定常开…」「浮层行内容…」三用例（vi.useFakeTimers 驱动防抖窗口）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-03: 同文件「浮层行点击跳转：非 pin 态选完即收…pin 态保持展开」+「刻度点击直跳…Enter」+「activeTurnKey…aria-current/scrollIntoView」

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-04: `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` 45 用例零改动通过（aria-label 契约延续）；tsc/eslint 实测见 verify 输出

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
