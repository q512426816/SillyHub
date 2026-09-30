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
- backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_adopted_title_survives_template_docs_push（documents 推送不回翻，实现前先红实证）
- backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_apply_parsed_fallback_keeps_semantic_title（reparse 兜底派生不覆盖段，实现前先红实证）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_custom_h1_docs_push_overrides_adopted_title（documents 推送自定义 H1 覆盖收养标题）
- backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_apply_parsed_fallback_keeps_semantic_title 后半段（ParsedChange 自定义 title 覆盖语义标题）
- backend/app/modules/change/tests/test_title_normalization.py::TestUpsertDocumentsTitle::test_custom_h1_in_deepest_doc_wins（既有改名回归保护，不回归）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/platform_sync/tests/test_change_deleted_guard.py::test_long_cli_title_truncated_progress_still_ok（600 字截 500 落库 + progress 上行仍 200；收养写库 try/except 为结构性 best-effort——失败注入需 mock commit，未单测，见 design 槽3/槽4）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/change/tests/test_title_normalization.py::TestIsFallbackDisplayTitle（四态兜底判定纯函数：空/key/去前缀语义名/裸模板 H1 文本 vs 语义标题）
- backend/app/modules/change/tests/test_title_normalization.py::TestUpsertDocumentsTitle::test_existing_row_title_refreshed（裸模板文本仍可被刷新——判定收敛不破坏既有语义）
- TITLE_MAX_LEN 截断由 FR-03 绑定用例覆盖（断言 落库值 == "甲"*500）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/change/tests/test_title_normalization.py 全文件 35 用例（含既有归一化/描述提取回归）
- backend/app/modules/platform_sync/tests/test_change_deleted_guard.py 全文件 18 用例（含收养五场景 + 删除守卫回归）
- backend/app/modules/platform_sync/tests/test_router.py -k documents 5 用例（端点回归）
