---
author: flow-machine-draft
created_at: 2026-10-02T01:19:25.817Z
---
# 需求规格（Requirements）— 2026-10-02-title-norm-thin-h1-family

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「
Given 系统就绪
When 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「决策记录（Decisions）— <变更名>」「验证回执（f
Then 行为符合本条标准描述

### FR-02: is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行
Given 系统就绪
When is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行可被后续推送/reparse 自愈刷新）
Then 行为符合本条标准描述

### FR-03: 收养语义标题在 thin 模板四件套 documents 推送后不回翻
Given 系统就绪
When 收养语义标题在 thin 模板四件套 documents 推送后不回翻
Then 行为符合本条标准描述

### FR-04: 既有词表条目与冒号自定义标题行为不变
Given 系统就绪
When 既有词表条目与冒号自定义标题行为不变
Then 行为符合本条标准描述

### FR-05: backend test_title_normalization.py 新增用例全绿且既有用例无回归
Given 系统就绪
When backend test_title_normalization.py 新增用例全绿且既有用例无回归
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 backend/app/modules/change/tests/test_title_normalization.py::TestNormalizeDisplayTitle::test_thin_flow_h1_family_falls_back_to_key；::TestUpsertDocumentsTitle::test_thin_template_docs_yield_key_derived_title ——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 backend/app/modules/change/tests/test_title_normalization.py::TestIsFallbackDisplayTitle::test_raw_thin_template_h1_text_is_fallback ——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_adopted_title_survives_thin_template_docs_push ——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 backend/app/modules/change/tests/test_title_normalization.py::TestNormalizeDisplayTitle::test_custom_h1_kept_as_is + ::test_template_h1_falls_back_to_key + ::test_template_h1_with_key_suffix_falls_back（既有用例不回归） ——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-05 backend/app/modules/change/tests/test_title_normalization.py 全文件 39 用例（35 既有 + 4 新增）实测全绿；platform_sync + change 两模块 907 passed / 2 skipped（既有无关跳过） ——例外裁决书写面（机器段之外合法） -->
