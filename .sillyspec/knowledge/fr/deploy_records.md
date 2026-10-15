---
author: sillyspec-fr-index
created_at: 2026-10-14T22:53:03.772Z
---

# FR 索引 — deploy_records

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/deploy_records.md（域=模块 id 同构；行为条目↔模块契约互跳）

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

## FR-auto-zcode-005 服务器有固定目录承载 multi-agent-platform 的 docs/releases 镜像（容器可读，经 /tmp 挂载）
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径；目录被清（/tmp 重启清空）
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-01
最近确认：c0d30b157200e183168da8c8872fdab1772b8097

## FR-auto-zcode-006 workspace 行指向该目录且页面能列出记录（seq/状态/提交数/正文渲染数据齐）
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-02
最近确认：c0d30b157200e183168da8c8872fdab1772b8097

## FR-auto-zcode-007 deploy-to-server skill 增「发布记录（每次部署必做）」节：写记录（引用 sillyhub-docker-deploy 契约）+ 部署后同步命令
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径；跳过同步
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-03
最近确认：c0d30b157200e183168da8c8872fdab1772b8097

## FR-auto-zcode-008 本次热修部署（a176393cb）补写记录 #002 并同步到服务器验证全链
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-04
最近确认：c0d30b157200e183168da8c8872fdab1772b8097
