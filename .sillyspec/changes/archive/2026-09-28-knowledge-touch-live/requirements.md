---
author: flow-machine-draft
created_at: 2026-09-28T13:57:00.343Z
---
# 需求规格（Requirements）— 2026-09-28-knowledge-touch-live

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: backend assets.py：knowledge_touch 并入实时命中——查本变更 inj
Given 上限 相关模块就绪
When backend assets.py：knowledge_touch 并入实时命中——查本变更 inject 行的 matched_anchors（file#sl
Then 行为符合本条标准描述

### FR-02: frontend 资产卡：在途态标签「知识触达（注入命中 · 实时）」区分归档态「待复核标记反查」；
Given 测试 相关模块就绪
When frontend 资产卡：在途态标签「知识触达（注入命中 · 实时）」区分归档态「待复核标记反查」；空态文案改写（在途也能有知识触达，FR/决策/测试绑定仍是归
Then 行为符合本条标准描述

### FR-03: 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，
Given 测试 相关模块就绪
When 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，设计内
Then 行为符合本条标准描述

### FR-04: 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits 
Given 系统就绪
When 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits inject 行，非标记）
Then 行为符合本条标准描述

### FR-05: 归档后标记反查与实时命中合并且去重（同一条目不重复出现）
Given 系统就绪
When 归档后标记反查与实时命中合并且去重（同一条目不重复出现）
Then 行为符合本条标准描述

### FR-06: 裸文件锚点（无 #）可显示
Given 系统就绪
When 裸文件锚点（无 #）可显示
Then 行为符合本条标准描述

### FR-07: live 合并上限 100 条
Given 上限 相关模块就绪
When live 合并上限 100 条
Then 行为符合本条标准描述

### FR-08: backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿
Given 测试 相关模块就绪
When backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿
Then 行为符合本条标准描述

### FR-09: tsc/eslint/ruff/mypy 0
Given 系统就绪
When tsc/eslint/ruff/mypy 0
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
backend/app/modules/change/tests/test_assets.py › test_live_touch_hits_inflight（在途无标记 + inject 行种子 → 触达三条两形态断言 + 他变更名/非 inject 行排除）
>

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同文件 › test_live_touch_merges_with_markers_dedupe（标记行序在前 + 同 (file,id) 归一去重 + live 补差）
>

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同文件 › test_live_touch_hits_inflight（patterns.md 裸文件断言）+ _live_touch_rows len>=100 早退（实现内建）
>

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx › 在途变更知识触达：实时命中渲染（「（注入命中 · 实时）」标签 + known-issues.md 裸文件深链 + 在途空态不出现）；全文件 24 用例全绿
>

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
backend test_assets.py 全文件 24 passed + ruff check/format 0 + mypy 0；frontend tsc 0
>

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
