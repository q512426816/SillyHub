---
author: flow-machine-draft
created_at: 2026-09-30T06:59:16.541Z
---
# 需求规格（Requirements）— 2026-09-30-takeover-tier3-ambiguous-msg

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）
Given 系统就绪
When takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）
Then 行为符合本条标准描述

### FR-02: 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置
Given 系统就绪
When 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置
Then 行为符合本条标准描述

### FR-03: 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）
Given 系统就绪
When 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_ambiguous_lists_machine_names

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching（既有四级矩阵用例零回归）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier4_no_match_409_with_machine_name（无命中文案态回归）
