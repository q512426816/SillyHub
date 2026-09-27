---
author: flow-machine-draft
created_at: 2026-09-27T09:00:33.252Z
---
# 需求规格（Requirements）— 2026-09-27-change-list-is-thin

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: ChangeSummary 含 is_thin（bool，default False 零破坏），后端
Given 测试 相关模块就绪
When ChangeSummary 含 is_thin（bool，default False 零破坏），后端投影测试覆盖三分支+时间窗负向
Then 行为符合本条标准描述

### FR-02: 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行
Given 前端 / api 相关模块就绪
When 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行显示「轻量」琥珀徽章，归档轻量与已归档状态并存
Then 行为符合本条标准描述

### FR-03: 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
Given 测试 / 前端 / api 相关模块就绪
When 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
Then 行为符合本条标准描述

### FR-04: 部署后浏览器验证归档区轻量行出身标识
Given 系统就绪
When 部署后浏览器验证归档区轻量行出身标识
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 -->
backend/app/modules/change/tests/test_enrich_projection.py 新增 6 用例（归档 flow-thin steps 兜底/标准痕迹 false/active thin 无 progress/quick 窗内 true/历史 quick false/空 steps false）——52 passed

<!--AGENT:测试绑定FR-02 -->
frontend 列表页 36 用例 + 详情域 277 + 组件域全量 437/437 全绿（16 处 mock 补字段）

<!--AGENT:测试绑定FR-03 -->
pnpm typecheck 0 + api-types.ts/openapi.json 重生成同批（diff +5/+5 行）

<!--AGENT:测试绑定FR-04 -->
部署后浏览器验证归档区轻量行（hover-polish 等行显「轻量」徽章+琥珀出身图标）
