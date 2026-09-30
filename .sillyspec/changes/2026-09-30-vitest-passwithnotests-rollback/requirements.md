---
author: flow-machine-draft
created_at: 2026-09-30T08:51:56.126Z
---
# 需求规格（Requirements）— 2026-09-30-vitest-passwithnotests-rollback

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: frontend/vitest.config.ts 移除 passWithNoTests，恢复正常 
Given 系统就绪
When frontend/vitest.config.ts 移除 passWithNoTests，恢复正常 vitest 语义（空收集报错）
Then 行为符合本条标准描述

### FR-02: 门禁复核：原始失败面下不再产生 vitest run e2e/auth.spec.ts 命令（已在 
Given e2e 相关模块就绪
When 门禁复核：原始失败面下不再产生 vitest run e2e/auth.spec.ts 命令（已在 sillyspec 仓验证）
Then 行为符合本条标准描述

### FR-03: 工具缺陷文档移入 docs/sillyspec/finished/ 并附处置记录
Given 系统就绪
When 工具缺陷文档移入 docs/sillyspec/finished/ 并附处置记录
Then 行为符合本条标准描述

### FR-04: 撤除后相关测试与门禁实测通过
Given 测试 相关模块就绪
When 撤除后相关测试与门禁实测通过
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
