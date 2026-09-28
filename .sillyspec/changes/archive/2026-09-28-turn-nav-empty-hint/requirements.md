---
author: flow-machine-draft
created_at: 2026-09-28T02:37:49.047Z
---
# 需求规格（Requirements）— 2026-09-28-turn-nav-empty-hint

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载
Given 系统就绪
When 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载
Then 行为符合本条标准描述

### FR-02: 点击加载」误导文案
Given 系统就绪
When 点击加载」误导文案
Then 行为符合本条标准描述

### FR-03: 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）
Given 系统就绪
When 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）
Then 行为符合本条标准描述

### FR-04: 桌面窄轨
Given 系统就绪
When 桌面窄轨
Then 行为符合本条标准描述

### FR-05: 浮层行与 mobile Drawer 的同源占位文案一并修正
Given 系统就绪
When 浮层行与 mobile Drawer 的同源占位文案一并修正
Then 行为符合本条标准描述

### FR-06: 相关测试改断言不改意图全绿，tsc
Given 测试 相关模块就绪
When 相关测试改断言不改意图全绿，tsc
Then 行为符合本条标准描述

### FR-07: eslint 零新增
Given 系统就绪
When eslint 零新增
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-01: `frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx`「浮层行内容：第N轮 + 摘要 + 相对时间；未加载无摘要占位文案」（占位断言「（无内容记录）」）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-02: 同文件「刻度 aria-label = 第N轮 · 状态 · 提问摘要…未加载追加『未加载』」（aria 状态语义保留）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-03: 不适用：Drawer 行与浮层行共用同一常量源（session-panel-page TURN_NAV_UNLOADED_HINT），由 FR-01 用例 + 组件同构保证；page.test 45 用例回归面覆盖挂载级

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-04: `frontend/src/components/sessions/__tests__/turn-catalog.test.tsx`「键盘 focus 触发飞出卡…」（旧组件 aria 后缀「· 未加载」断言）+ sessions/__tests__ 与 sessions 页面 404/405 全量（唯一失败为登记预存债）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
