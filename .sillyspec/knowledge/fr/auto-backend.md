---
author: sillyspec-fr-index
created_at: 2026-10-14T22:52:28.436Z
---

# FR 索引 — auto-backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-backend-224 _iter_files 读文件容错扩为捕获 (OSError, UnicodeDecodeError)，坏编码文件降级为 invalid 条目（parse_error 与读失败同口径）
变更：2026-10-15-deploy-records-unicode-tolerance
状态：active
摘要：坏编码文件不炸整表；坏编码文件详情可读不抛错
全文：.sillyspec/changes/archive/2026-10-15-deploy-records-unicode-tolerance/requirements.md#FR-01
最近确认：95d37f93be47e223ffc6a1f405535b13f7de5d20

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-deploy-records-unicode-tolerance:flow:测试绑定FR-01
  tests: backend/app/modules/deploy_records/tests/test_service.py「test_non_utf8_file_degrades_to_invalid」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-deploy-records-unicode-tolerance
  status: active

## FR-auto-backend-225 test_service.py 新增 GBK 坏编码文件用例：列表正常返回且该条目 status=invalid，其余合法记录不受影响
变更：2026-10-15-deploy-records-unicode-tolerance
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-deploy-records-unicode-tolerance/requirements.md#FR-02
最近确认：95d37f93be47e223ffc6a1f405535b13f7de5d20

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-deploy-records-unicode-tolerance:flow:测试绑定FR-02
  tests: backend/app/modules/deploy_records/tests/test_service.py「test_non_utf8_file_degrades_to_invalid」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-deploy-records-unicode-tolerance
  status: active

## FR-auto-backend-226 既有 deploy_records 测试（test_service.py + test_router.py）全绿
变更：2026-10-15-deploy-records-unicode-tolerance
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-deploy-records-unicode-tolerance/requirements.md#FR-03
最近确认：95d37f93be47e223ffc6a1f405535b13f7de5d20

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-deploy-records-unicode-tolerance:flow:测试绑定FR-03
  tests: backend/app/modules/deploy_records/tests/test_router.py「全量既有用例回归」 | backend/app/modules/deploy_records/tests/test_service.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-deploy-records-unicode-tolerance
  status: active
