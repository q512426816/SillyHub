---
author: flow-machine-draft
created_at: 2026-09-30T00:34:57.823Z
---
# 需求规格（Requirements）— 2026-09-30-title-adopt-clobber-guard

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 收养后的语义标题在模板 H1 documents 推送与全量 reparse 后保持不变（不被回翻为
Given 系统就绪
When 收养后的语义标题在模板 H1 documents 推送与全量 reparse 后保持不变（不被回翻为 key 派生名）
Then 行为符合本条标准描述

### FR-02: 自定义 H1（--title 改名通道）经 documents 推送/reparse 仍能覆盖既有标
Given 系统就绪
When 自定义 H1（--title 改名通道）经 documents 推送/reparse 仍能覆盖既有标题（改名能力不回归）
Then 行为符合本条标准描述

### FR-03: body.changes[].title 超 500 字时截断到 500 再落库，收养段写库异常仅告
Given 系统就绪
When body.changes[].title 超 500 字时截断到 500 再落库，收养段写库异常仅告警不阻断 progress 上行（200 不变）
Then 行为符合本条标准描述

### FR-04: 兜底形态判定（空/等于 key/等于去日期前缀）与 500 上限收敛到 title_norm 一处，
Given 上限 相关模块就绪
When 兜底形态判定（空/等于 key/等于去日期前缀）与 500 上限收敛到 title_norm 一处，三条写路径共用
Then 行为符合本条标准描述

### FR-05: 相关测试全绿（platform_sync 收养/documents 交互 + title_norm 
Given 测试 相关模块就绪
When 相关测试全绿（platform_sync 收养/documents 交互 + title_norm 助手 + _apply_parsed 守卫）
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
