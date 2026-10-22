---
author: flow-machine-draft
created_at: 2026-10-22T07:49:11.302Z
---
# 需求规格（Requirements）— 2026-10-22-merge-test-debt

## 功能需求

### FR-01: tests/core/test_error_message_l10n.py 全参数化用例绿（vector_router/session_attachment 两 offender 清零）

- vector_router.py 与 session_attachment/router.py 中 raise 的报错 message 常量段必须含 CJK（守卫文件清单内零 offender），禁止纯英文/纯标点字面量回归。

#### 场景：主路径

Given 合并后的 backend 工作区 / When 跑 tests/core/test_error_message_l10n.py 全参数化 / Then 两个原 offender（`Knowledge vector-search requires...`、` MB。`）清零，套件全绿。

### FR-02: test_mission_session_id::test_agent_sessions_model_fields_unchanged 绿（expected 补 title_fallback）

- AgentSession 模型字段钉子的 expected 集必须与 model_fields 完全一致（含 2026-10-16 落地的 title_fallback），禁止守卫清单落后于模型。

#### 场景：主路径

Given AgentSession 含 28 字段（含 title_fallback）/ When 跑字段钉子用例 / Then 集合相等断言通过。

### FR-03: sillyhub-daemon tests/adapters/json-rpc.test.ts 60/60 绿（clientInfo.version 改与 DAEMON_VERSION 同源断言）

- codex 握手 clientInfo.version 断言必须与实现同源（import DAEMON_VERSION 单一来源），禁止硬编码版本字面量（随 package.json 提升必假败）。

#### 场景：主路径

Given package.json version=0.2.0 / When 跑 json-rpc.test.ts / Then 握手用例随 DAEMON_VERSION 同源通过，60/60 绿。

### FR-04: 四处修复均为守卫/文案同步，无业务逻辑变更

- 本变更必须只触及报错文案常量与测试断言载体，禁止改变任何鉴权判定、HTTP 状态码、details 结构或 daemon src/ 行为。

#### 场景：主路径

Given diff 面 = 2 个 backend 文案文件 + 2 个测试文件 / When 逐 hunk 核对 / Then 无逻辑行变更（仅文案字符串与断言/清单/注释）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/core/test_error_message_l10n.py「test_error_message_contains_cjk[app/modules/knowledge/vector_router.py]」
FR-01: backend/tests/core/test_error_message_l10n.py「test_error_message_contains_cjk[app/modules/session_attachment/router.py]」
FR-02: backend/app/modules/agent/tests/test_mission_session_id.py「test_agent_sessions_model_fields_unchanged」
FR-03: sillyhub-daemon/tests/adapters/json-rpc.test.ts「buildHandshake - codex 协议握手序列（ql-20260617-008）> 返回 3 行 JSON-RPC 消息（initialize/initialized/thread.start）」
FR-04: 不适用：纯 diff 面核对类约束（无独立可执行测试；由收口评审对 change.patch 逐 hunk 核验）
