---
author: flow-machine-draft
created_at: 2026-09-26T23:28:32.582Z
---
# 需求规格（Requirements）— 2026-09-27-audit-followup-hardening

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: _read_touched_modules 对含 .. 段或绝对路径的 doc 值不读盘：模块名回退
Given 系统就绪
When _read_touched_modules 对含 .. 段或绝对路径的 doc 值不读盘：模块名回退 id、doc 字段不外发越界路径（不放 chip），正常相
Then 行为符合本条标准描述

### FR-02: docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA
Given 系统就绪
When docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA 覆盖行删除并留同 backend 口径的注释说明
Then 行为符合本条标准描述

### FR-03: gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）
Given api 相关模块就绪
When gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）
Then 行为符合本条标准描述

### FR-04: 234000 迁移 docstring 补 stranded revision 人工 stamp 运
Given 迁移 相关模块就绪
When 234000 迁移 docstring 补 stranded revision 人工 stamp 运维注记
Then 行为符合本条标准描述

### FR-05: test_assets 新增越界 doc 用例（..
Given 系统就绪
When test_assets 新增越界 doc 用例（..
Then 行为符合本条标准描述

### FR-06: 与绝对路径两形态）绿，既有聚焦测试绿
Given 测试 相关模块就绪
When 与绝对路径两形态）绿，既有聚焦测试绿
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_assets.py::test_touched_modules_doc_traversal_guard（../、/etc/passwd、C:\Windows 三形态 + 正常相对 doc 回归四面断言）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：compose 为部署配置无测试面——yaml 解析验证（7 services、frontend.environment 无该键）+ 注释与 backend 侧（2026-09-26-deploy-eng-hardening 已删行）同口径留档

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：构建脚本文案格式无断言面——node --check 语法验证 0 错，守卫逻辑（exit 1 路径）未被触碰

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/tests/test_align_platform_change_events_migration.py 全套（docstring-only 改动后 12 passed 复跑，迁移行为零变化验证）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_assets.py::test_touched_modules_doc_traversal_guard（同 FR-01 用例即覆盖「../ 与绝对路径两形态 + 既有聚焦回归」）
backend/app/modules/change/tests/test_assets.py 全套 22 passed（含新用例）；ruff check assets.py/test_assets.py/迁移文件 All checks passed；mypy assets.py no issues；node --check gen 脚本 OK；compose yaml 解析 OK

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_assets.py 全套 22 passed（既有 21 零回归 + 新 1）；ruff/mypy/node --check/yaml 解析全过（同 FR-05 验证面汇总）
