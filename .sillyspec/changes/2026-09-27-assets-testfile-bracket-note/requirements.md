---
author: flow-machine-draft
created_at: 2026-09-27T10:06:59.928Z
---
# 需求规格（Requirements）— 2026-09-27-assets-testfile-bracket-note

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍
Given 系统就绪
When normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍按未找到处理
Then 行为符合本条标准描述

### FR-02: TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值
Given 系统就绪
When TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值
Then 行为符合本条标准描述

### FR-03: 后缀命中并打开真实测试文件预览
Given 测试 相关模块就绪
When 后缀命中并打开真实测试文件预览
Then 行为符合本条标准描述

### FR-04: 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文
Given 系统就绪
When 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文件名
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::注解剥离（一段/多段「」段移除）+ 全注解串：剥离后为空仍按未找到处理

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::注解剥离：按干净文件名发起搜索并等值命中预览（断言 mockSearch 收到干净 basename）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::多段注解剥离：短路径唯一后缀救回并预览真实路径

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::ChangeAssetsCard 测试文件路径解析 全套 22 passed（新增 3 条覆盖多段注解与搜索入参干净文件名）
