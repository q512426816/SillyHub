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

## FR-core-008 会话思考内容默认显示中文译文，可一键切回原文；折叠摘要流式结束后亦译为中文
变更：2026-10-19-thinking-zh-translate
状态：active
摘要：展开查看译文；流式中不发请求；中文内容跳过；模型不可用降级
场景正文：
- 场景：展开查看译文 — Given 一条英文思考内容已流式完成，When 用户展开思考折叠块，Then 正文默认显示中文译文（未就绪时短暂显示原文 + 翻译中标记），且提供「显示原文」切换。
- 场景：流式中不发请求 — Given 思考内容正在流式增量到达，When 折叠摘要实时更新，Then 不发起任何翻译请求（摘要显示原文 + 思考中脉冲）；流结束后摘要自动换为中文。
- 场景：中文内容跳过 — Given 思考文本以中文为主，When 渲染，Then 直接展示原文，不发起翻译请求。
- 场景：模型不可用降级 — Given 后端翻译模型未就绪，When 用户展开思考块，Then 显示原文并出现一次性的「离线翻译未就绪」轻提示，后续请求按退避节流。
全文：.sillyspec/changes/archive/2026-10-19-thinking-zh-translate/requirements.md#FR-01
最近确认：bfa6357537da5377966ec9d747dc47fbd9e53709

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-thinking-zh-translate:flow:测试绑定FR-01
  tests: frontend/src/components/thinking-translate/__tests__/translated-thinking.test.tsx「展开默认译文 + 一键切原文」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-thinking-zh-translate
  status: active

## FR-core-009 翻译为本地离线推理（后端 CTranslate2 + opus-mt-en-zh int8 量化模型，首用自动下载、可配置本地目录），全程无外部云翻译 API 调用
变更：2026-10-19-thinking-zh-translate
状态：active
摘要：离线部署；模型缺席
场景正文：
- 场景：离线部署 — Given 部署环境无外网且已预置模型目录（TRANSLATE_MODEL_DIR），When 前端请求翻译，Then 本地推理正常返回译文。
- 场景：模型缺席 — Given 模型未下载且无法联网，When 前端请求翻译，Then 返回 200 + engine_ready=false + 原文透传，前端降级显示原文。
全文：.sillyspec/changes/archive/2026-10-19-thinking-zh-translate/requirements.md#FR-02
最近确认：bfa6357537da5377966ec9d747dc47fbd9e53709

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-thinking-zh-translate:flow:测试绑定FR-02
  tests: backend/app/modules/translate/tests/test_chunking.py「代码块/行内代码/URL 保护不送翻」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-thinking-zh-translate
  status: active

## FR-core-010 性能可控：按需触发（用户展开或流式结束后）、文本分块并发、译文缓存（内存 LRU + Redis），不阻塞会话流式渲染；模型不可用时优雅降级显示原文
变更：2026-10-19-thinking-zh-translate
状态：active
摘要：同屏多思考块；缓存命中；超长思考
场景正文：
- 场景：同屏多思考块 — Given 「全部」视图一次挂载 10 个思考折叠块，When 流已结束，Then 10 条摘要翻译合并为 1 个批量请求（单次网络往返）。
- 场景：缓存命中 — Given 同一思考文本第二次被请求（刷新页面/重新展开），When 后端收到请求，Then LRU/Redis 命中直接返回，不触发模型推理。
- 场景：超长思考 — Given 单条思考 20000 字符，When 用户展开，Then 前端按段分块多请求按序渲染，不出现整条超时。
全文：.sillyspec/changes/archive/2026-10-19-thinking-zh-translate/requirements.md#FR-03
最近确认：bfa6357537da5377966ec9d747dc47fbd9e53709

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-thinking-zh-translate:flow:测试绑定FR-03
  tests: backend/app/modules/translate/tests/test_chunking.py「长文按段分块边界」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-thinking-zh-translate
  status: active

## FR-core-011 覆盖三条思考渲染路径：daemon 会话面板时间线、AgentLogViewer、agent-logs 回放卡
变更：2026-10-19-thinking-zh-translate
状态：active
摘要：三路径一致
场景正文：
- 场景：三路径一致 — Given 翻译引擎正常，When 分别在会话面板、AgentLogViewer、回放卡查看英文思考，Then 三处均默认中文展示且可切原文。
全文：.sillyspec/changes/archive/2026-10-19-thinking-zh-translate/requirements.md#FR-04
最近确认：bfa6357537da5377966ec9d747dc47fbd9e53709

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-thinking-zh-translate:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-segment-views-thinking-translate.test.tsx「ThinkingRowView 接入翻译」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-thinking-zh-translate
  status: active

## FR-core-012 真机 live 测试全绿：worker 子进程译文含中文且无重复循环乱码；端点全链路 engine_ready=true、译文 translated=true、围栏代码块与 URL 保护段原样保留
变更：2026-10-19-translate-live-verify
状态：active
摘要：真模型推理；EOS 协议回归锚
场景正文：
- 场景：真模型推理 — Given 默认模型仓库已下载到本机 HF 缓存，When 以 TRANSLATE_LIVE_TEST=1 运行 live 测试，Then worker 与端点两级用例全部
- 场景：EOS 协议回归锚 — Given sentencepiece 分词路径（transformers 缺席），When 编码源文本，Then 必须手动追加 `</s>`（ct2 opus-mt 转换
全文：.sillyspec/changes/archive/2026-10-19-translate-live-verify/requirements.md#FR-01
最近确认：ffd511d4eb260046f3803cfa16492f4e0e55a0a7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-translate-live-verify:flow:测试绑定FR-01
  tests: backend/app/modules/translate/tests/test_live_engine.py「test_live_endpoint_full_chain」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-translate-live-verify
  status: active

## FR-core-013 既有 translate 模块测试（mock 面）全绿零回归
变更：2026-10-19-translate-live-verify
状态：active
摘要：默认跳过
场景正文：
- 场景：默认跳过 — Given 未设置 TRANSLATE_LIVE_TEST，When 运行 translate 模块测试，Then live 用例 skip、其余全绿。
全文：.sillyspec/changes/archive/2026-10-19-translate-live-verify/requirements.md#FR-02
最近确认：ffd511d4eb260046f3803cfa16492f4e0e55a0a7

## FR-core-014 config.py 默认 repo 与 backend/app/modules/translate/README.md 一致指向可用仓库
变更：2026-10-19-translate-live-verify
状态：active
摘要：默认开箱可用
场景正文：
- 场景：默认开箱可用 — Given 联网（或 HF 镜像）环境零配置启动，When 首次翻译请求触发模型下载，Then 默认 repo 可解析下载并正常推理。
全文：.sillyspec/changes/archive/2026-10-19-translate-live-verify/requirements.md#FR-03
最近确认：ffd511d4eb260046f3803cfa16492f4e0e55a0a7
