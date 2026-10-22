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

## FR-core-015 deploy/.env 追加 KNOWLEDGE_SEARCH_SERVER_BUILD=0（gitignore 不入库），backend 镜像重建+容器 force-recreate 后容器内 settings.knowledge_search_server_build 实测为 False 且新代码在场
变更：2026-10-19-knowledge-build-switch-rollout
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-knowledge-build-switch-rollout/requirements.md#FR-01
最近确认：cb7394b3637b8bab1e1d746dbb2454c658bb6e85

## FR-core-016 未建索引工作区首搜端到端实测：秒级返回 + reason=index_not_built + knowledge_search_state/chunks 零新增（证据落盘）
变更：2026-10-19-knowledge-build-switch-rollout
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-knowledge-build-switch-rollout/requirements.md#FR-02
最近确认：cb7394b3637b8bab1e1d746dbb2454c658bb6e85

## FR-core-017 发布记录按 deploy skill 规范写入 docs/releases/；known-issues 地雷条目状态更新（本地已配实证、生产剩 env 一动作）
变更：2026-10-19-knowledge-build-switch-rollout
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-knowledge-build-switch-rollout/requirements.md#FR-03
最近确认：cb7394b3637b8bab1e1d746dbb2454c658bb6e85

## FR-core-018 assets DTO 增 scopeAudit.repos 元数据（key/锚点/计数/降级/patchSha256，不回传 patch 正文），旧归档无 repos 时零变化
变更：2026-10-19-change-assets-cross-repo-repos
状态：active
摘要：跨仓冻结投影；旧归档兼容
全文：.sillyspec/changes/archive/2026-10-19-change-assets-cross-repo-repos/requirements.md#FR-01
最近确认：9043c1a83f53bb4bcd5fd05fe3fd8529a5c0132d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-change-assets-cross-repo-repos:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_assets.py::test_patch_meta_projects_cross_repo_metadata | backend/app/modules/change/tests/test_assets.py::test_patch_meta_without_repos_key_is_backward_compatible
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-change-assets-cross-repo-repos
  status: active

## FR-core-019 变更资产卡按仓分段展示跨仓冻结面，并标注主仓/各仓口径避免双计歧义
变更：2026-10-19-change-assets-cross-repo-repos
状态：active
摘要：有跨仓面；无跨仓面
全文：.sillyspec/changes/archive/2026-10-19-change-assets-cross-repo-repos/requirements.md#FR-02
最近确认：9043c1a83f53bb4bcd5fd05fe3fd8529a5c0132d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-change-assets-cross-repo-repos:flow:测试绑定FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-change-assets-cross-repo-repos
  status: active

## FR-core-020 后端单测覆盖 repos 投影与缺键/降级形态，前端类型检查与构建通过
变更：2026-10-19-change-assets-cross-repo-repos
状态：active
摘要：验证面
全文：.sillyspec/changes/archive/2026-10-19-change-assets-cross-repo-repos/requirements.md#FR-03
最近确认：9043c1a83f53bb4bcd5fd05fe3fd8529a5c0132d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-change-assets-cross-repo-repos:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_assets.py::test_patch_meta_projects_cross_repo_metadata | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-change-assets-cross-repo-repos
  status: active

## FR-core-021 既有 patch 语义不变：files/totals 仍为主仓面
变更：2026-10-19-change-assets-cross-repo-repos
状态：active
摘要：主仓面隔离
全文：.sillyspec/changes/archive/2026-10-19-change-assets-cross-repo-repos/requirements.md#FR-04
最近确认：9043c1a83f53bb4bcd5fd05fe3fd8529a5c0132d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-change-assets-cross-repo-repos:flow:测试绑定FR-04
  tests: backend/app/modules/change/tests/test_assets.py::test_patch_meta_projects_cross_repo_metadata
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-change-assets-cross-repo-repos
  status: active

## FR-core-022 inject 在会话非 idle 时不再 ack 了事：排队补启或拒绝，不产生无 started_at 的悬挂 run
变更：2026-10-21-daemon-zombie-turn
状态：active
摘要：打断收尾竞态吞没 inject（主事故路径）；正常启动的轮不误伤
全文：.sillyspec/changes/archive/2026-10-21-daemon-zombie-turn/requirements.md#FR-01
最近确认：2f5e3bcf95c06deec30f390c8abbf76461b28db3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-zombie-turn:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「inject 布防/事件撤防/到点收敛上报/终态撤防」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-zombie-turn
  status: active

## FR-core-023 interrupt 对非 running 的 no-op 结果回传后端；后端对 acked-but-ineffective 打断立即收敛 pending run 并通知前端
变更：2026-10-21-daemon-zombie-turn
状态：active
摘要：僵尸 run 上按打断（事故主场景）
全文：.sillyspec/changes/archive/2026-10-21-daemon-zombie-turn/requirements.md#FR-02
最近确认：2f5e3bcf95c06deec30f390c8abbf76461b28db3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-zombie-turn:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_interrupt_payload_run_id.py「interrupt payload 携带 run_id」 | sillyhub-daemon/tests/daemon-interrupt-noop-report.test.ts「interrupt false 回传 notifyRunResult / 会话缺失不回报」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-zombie-turn
  status: active

## FR-core-024 后端主动清扫「创建后 N 秒未被 daemon 启动」的 pending run（N 可配置）
变更：2026-10-21-daemon-zombie-turn
状态：active
摘要：僵尸 pending run 兜底收敛
全文：.sillyspec/changes/archive/2026-10-21-daemon-zombie-turn/requirements.md#FR-03
最近确认：2f5e3bcf95c06deec30f390c8abbf76461b28db3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-zombie-turn:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_pending_run_start_sweep.py「超龄在线 pending run 收敛 / 新 run·审批等待·离线 runtime 不扫」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-zombie-turn
  status: active

## FR-core-025 前端打断 15s 超时回退提示，不再永久停在「打断中」
变更：2026-10-21-daemon-zombie-turn
状态：active
摘要：打断无效不卡死
全文：.sillyspec/changes/archive/2026-10-21-daemon-zombie-turn/requirements.md#FR-04
最近确认：2f5e3bcf95c06deec30f390c8abbf76461b28db3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-zombie-turn:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/session-panel/__tests__/interrupt-timeout.test.ts「15s 到点回退 running+提示 / 终态到达清定时器」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-zombie-turn
  status: active

## FR-core-026 前端该 POST 请求带显式超时（20s），超时按引擎不可用处理并进入退避，界面不再无限等待
变更：2026-10-22-fix-translate-pending
状态：active
摘要：超时降级；正常返回不受影响
全文：.sillyspec/changes/archive/2026-10-22-fix-translate-pending/requirements.md#FR-01
最近确认：e7ce2a10150c7e18627369ed72fd5400c1e4e5a9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-fix-translate-pending:flow:测试绑定FR-01
  tests: frontend/src/lib/__tests__/thinking-translate.test.ts「translateText 请求带 20s 超时并可被超时降级」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-fix-translate-pending
  status: active

## FR-core-027 后端子进程请求超时改为可配置且默认收紧到 20s（现 300s），超时 fail-soft 返回原文
变更：2026-10-22-fix-translate-pending
状态：active
摘要：慢子进程触发 fail-soft；正常推理不误杀
全文：.sillyspec/changes/archive/2026-10-22-fix-translate-pending/requirements.md#FR-02
最近确认：e7ce2a10150c7e18627369ed72fd5400c1e4e5a9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-fix-translate-pending:flow:测试绑定FR-02
  tests: backend/app/modules/translate/tests/test_engine.py「request_timeout_sec 可配置且超时 fail-soft」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-fix-translate-pending
  status: active

## FR-core-028 worker 子进程 stderr 落盘可查（含模型下载/加载失败原因），不再丢进 DEVNULL
变更：2026-10-22-fix-translate-pending
状态：active
摘要：模型下载失败留痕
全文：.sillyspec/changes/archive/2026-10-22-fix-translate-pending/requirements.md#FR-03
最近确认：e7ce2a10150c7e18627369ed72fd5400c1e4e5a9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-fix-translate-pending:flow:测试绑定FR-03
  tests: backend/app/modules/translate/tests/test_engine.py「worker stderr 进入主进程日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-fix-translate-pending
  status: active

## FR-core-029 生产服务器预置 opus-mt-en-zh 模型目录并配置 TRANSLATE_MODEL_DIR，接口返回 engine_ready=true 且英文思考文本译文含中文
变更：2026-10-22-fix-translate-pending
状态：active
摘要：生产零下载加载；目录缺失时保持 fail-soft
全文：.sillyspec/changes/archive/2026-10-22-fix-translate-pending/requirements.md#FR-04
最近确认：e7ce2a10150c7e18627369ed72fd5400c1e4e5a9

## FR-core-030 相关测试通过：后端 translate 模块测试、前端 thinking-translate 测试
变更：2026-10-22-fix-translate-pending
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-22-fix-translate-pending/requirements.md#FR-05
最近确认：e7ce2a10150c7e18627369ed72fd5400c1e4e5a9

## FR-core-031 会话面板视图切换为三态：对话 / 进度 / 轨迹，轨迹与另外两态同层并列
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径；旧会话默认值
场景正文：
- 场景：主路径 — Given 一个有历史轮的会话；When 查看顶部视图切换；Then 三枚 tab「对话 / 进度 / 轨迹」同层并列、默认选中「对话」；When 点「轨迹」；Then `
- 场景：旧会话默认值 — Given localStorage 无本会话的视图记录；When 打开会话；Then 默认「对话」，与现状一致。
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-01
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-third-view:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/session-panel/__tests__/session-view-tabs.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-third-view
  status: active

## FR-core-032 「进度」视图恢复纯时间线，不再出现「时间线 / 轨迹」第二层开关
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 有历史轮的会话；When 切到「进度」；Then 轮块（`data-testid="turn-block"`）照常渲染，页面中不存在 `progress-len
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-02
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-third-view:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-third-view
  status: active

## FR-core-033 选择「轨迹」直接渲染三泳道面板，点击账本行或时间轴条目可选中并在右侧检查器看输入/输出，↑/↓ 切换、Esc 清除
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-03
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-third-view:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-third-view
  status: active

## FR-core-034 无可绘制时序时轨迹视图仍显示显式空态提示，不白屏不伪造
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 轮视图缺时间戳且无段；When 切到「轨迹」；Then 出现「没有可绘制的时间数据」提示，且不出现三泳道面板与轮块。
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-04
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-third-view:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-third-view
  status: active

## FR-core-035 视图选择按会话持久化，「轨迹」刷新后仍保持
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径；旧值兼容
场景正文：
- 场景：主路径 — Given 某会话当前为「轨迹」；When 刷新页面；Then 视图仍为「轨迹」。
- 场景：旧值兼容 — Given localStorage 存的是 `"all"`；When 打开会话；Then 视图为「进度」；存的是无法识别的值时回落「对话」。
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-05
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-third-view:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/session-panel/__tests__/view-mode-persist.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-third-view
  status: active

## FR-core-036 弹窗版、整页版、移动版三处会话面板行为一致
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 移动端打开会话；When 查看视图切换；Then 同样出现三枚 tab；When 点「轨迹」；Then 与桌面一致直接渲染轨迹面板。
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-06
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-third-view:flow:测试绑定FR-06
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/session-panel/__tests__/session-view-tabs.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-third-view
  status: active

## FR-core-037 新增/更新用例全绿，既有会话面板、轨迹、回放相关用例零回归且不改既有断言
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑会话面板、轨迹、回放相关测试；Then 全部通过且无跳过的既有断言。
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-07
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-third-view:flow:测试绑定FR-07
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-third-view
  status: active

## FR-core-038 frontend tsc --noEmit 退出 0
变更：2026-10-22-session-trajectory-third-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 在 `frontend` 跑 `pnpm exec tsc --noEmit`；Then 退出码为 0。
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-third-view/requirements.md#FR-08
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e
