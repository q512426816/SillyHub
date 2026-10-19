---
author: sillyspec-fr-index
created_at: 2026-10-15T11:57:05.061Z
---

# FR 索引 — core

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/core.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-core-001 日志文件落盘与轮转
变更：2026-10-15-server-logs-panel
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 后端日志现仅输出 stderr（structlog JSON）；When 本次变更后应用运行并产生日志
全文：.sillyspec/changes/archive/2026-10-15-server-logs-panel/requirements.md#FR-01
最近确认：7af8e0e32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-server-logs-panel:task-01:acc-0-38ffaedf
  tests: backend/tests/test_server_log_filer.py | backend/tests/test_server_logs_api.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-01:acc-1-4e186dc8
  tests: backend/tests/test_server_log_filer.py | backend/tests/test_server_logs_api.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-01:acc-2-797d32a3
  tests: backend/tests/test_server_log_filer.py | backend/tests/test_server_logs_api.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-01:acc-3-39f950e5
  tests: backend/tests/test_server_log_filer.py | backend/tests/test_server_logs_api.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-01:acc-4-ad6585bf
  tests: backend/tests/test_server_log_filer.py | backend/tests/test_server_logs_api.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active

## FR-core-002 日志展示端点
变更：2026-10-15-server-logs-panel
状态：active
摘要：默认场景
依据决策：D-002@v1、D-004@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 管理员登录且持 system_status:read；When GET /api/server-logs?lines=N（N ∈ {100,200,500,1000}，非白名单回退 200）；Then 必须返回文件尾部 N 行：JSON 行解析为 {time, level, event, fields}，非 JSON 行必须按原文降级展示不丢行；响应须含 to
全文：.sillyspec/changes/archive/2026-10-15-server-logs-panel/requirements.md#FR-02
最近确认：7af8e0e32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-server-logs-panel:task-02:acc-0-d0944973
  tests: backend/tests/test_server_logs_api.py | frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-02:acc-1-baab6997
  tests: backend/tests/test_server_logs_api.py | frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-02:acc-2-c92d7888
  tests: backend/tests/test_server_logs_api.py | frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-02:acc-3-3c2570d1
  tests: backend/tests/test_server_logs_api.py | frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-02:acc-4-13e08884
  tests: backend/tests/test_server_logs_api.py | frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-03:acc-0-684fdc75
  tests: frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-03:acc-1-6d018a67
  tests: frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-03:acc-2-5f864f77
  tests: frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | frontend/src/components/__tests__/server-log-panel.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active

## FR-core-003 日志下载端点
变更：2026-10-15-server-logs-panel
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 管理员登录且持 system_status:read；When GET /api/server-logs/download?file=<name>（name ∈ {backend.log, backend.log.1, ba；Then 必须返回该文件流（Content-Disposition attachment，文件名白名单外的值必须 400/404 拒绝——目录遍历防护）；文件不存在 40
全文：.sillyspec/changes/archive/2026-10-15-server-logs-panel/requirements.md#FR-03
最近确认：7af8e0e32

## FR-core-004 页面改造（删统计卡+日志卡）
变更：2026-10-15-server-logs-panel
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 管理员登录进入 /admin/server-status；When 页面加载及此后每 5 秒 下载被点击；Then 业务统计卡（四格）必须已移除；「服务器日志」卡必须满宽置底渲染——行数切换（100/200/500/1000）、日志流按级别着色（INFO/WARN/ERROR
全文：.sillyspec/changes/archive/2026-10-15-server-logs-panel/requirements.md#FR-04
最近确认：7af8e0e32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-server-logs-panel:task-04:acc-0-c5581cb4
  tests: frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-04:acc-1-7614d9ae
  tests: frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active
- row: 2026-10-15-server-logs-panel:task-04:acc-2-e2b500e0
  tests: frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-server-logs-panel
  status: active

## FR-core-005 新增配置开关（默认开启建库=现行为零变化）；关闭时未建索引工作区首搜不触发建库/嵌入，直接词面降级返回且带 reason=index_not_built，秒回不超时
变更：2026-10-19-knowledge-search-build-switch
状态：active
摘要：开关关闭+未建索引工作区首搜；默认开关（不传/为 True）
全文：.sillyspec/changes/archive/2026-10-19-knowledge-search-build-switch/requirements.md#FR-01
最近确认：54a1e8db39d4d8ac991d645e2942a370d146e4ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-knowledge-search-build-switch:flow:测试绑定FR-01
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py「禁建库：未建索引工作区首搜词面降级零建库」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-knowledge-search-build-switch
  status: active

## FR-core-006 关闭路径 pytest 单测覆盖（不建库断言+降级语义+reason 字段），指定面全绿
变更：2026-10-19-knowledge-search-build-switch
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-knowledge-search-build-switch/requirements.md#FR-02
最近确认：54a1e8db39d4d8ac991d645e2942a370d146e4ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-knowledge-search-build-switch:flow:测试绑定FR-02
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py「禁建库：有索引直接查库跳过 sync / 默认缺省仍懒建库」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-knowledge-search-build-switch
  status: active

## FR-core-007 known-issues 该条目状态更新为已根治（运维缓解+代码根治双闭环）
变更：2026-10-19-knowledge-search-build-switch
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-knowledge-search-build-switch/requirements.md#FR-03
最近确认：54a1e8db39d4d8ac991d645e2942a370d146e4ff
