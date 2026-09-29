---
author: flow-machine-draft
created_at: 2026-09-29T00:09:15.861Z
---
# 需求规格（Requirements）— 2026-09-29-jump-empty-turn-dup

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prep
Given 系统就绪
When 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prepend 块）
Then 行为符合本条标准描述

### FR-02: 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）
Given 高亮 相关模块就绪
When 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）
Then 行为符合本条标准描述

### FR-03: 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错
Given 测试 相关模块就绪
When 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx :: task-01/02（2026-09-29-jump-empty-turn-dup）：零正文轮（有日志但全不可渲染）二次点击不重复单轮直达 prepend（runIdCallCount 二次点击后恒 1 + ancientRowCount ≤1；stash 修复实证先红 expected 2 to be 1）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx :: task-01/02（2026-09-29-jump-empty-turn-dup）：零正文轮（有日志但全不可渲染）二次点击不重复单轮直达 prepend（首点 runIdCallCount=1 + expectJumpScrolled 定位高亮 + beforeCallCount=0）；frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx :: task-04（FR-05）：大纲有 run_id 的未加载轮点击 → 单轮请求直达（零翻页）prepend + 定位高亮（既有有正文直达回归）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx :: task-04（FR-05）：单轮请求失败 → 回退 interval 翻页链路 + task-04（FR-05）：单轮请求命中但日志为空 → 「该轮次日志不存在」兜底（既有回退/兜底回归，46/46 全绿）；tsc/eslint 0 错为命令门（pnpm -C frontend exec tsc --noEmit / eslint 两触达文件 0 error，5 warning 预存债），无单用例面
