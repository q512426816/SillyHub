---
author: flow-machine-draft
created_at: 2026-09-30T07:27:52.459Z
---
# 需求规格（Requirements）— 2026-09-30-takeover-handoff-any-location

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引
Given 系统就绪
When handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引擎），服务端校验属主+在线后用作派发位置
Then 行为符合本条标准描述

### FR-02: 缺省保持原四级匹配（原机）不回归
Given 系统就绪
When 缺省保持原四级匹配（原机）不回归
Then 行为符合本条标准描述

### FR-03: handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=fa
Given 系统就绪
When handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=false 降级继续）
Then 行为符合本条标准描述

### FR-04: 未传 runtime_id 且原机无匹配仍 409
Given 系统就绪
When 未传 runtime_id 且原机无匹配仍 409
Then 行为符合本条标准描述

### FR-05: 前端 handoff 档选择器为两级（在线机器 → 该机白名单在线引擎），默认预选上报机器
Given 前端 相关模块就绪
When 前端 handoff 档选择器为两级（在线机器
Then 该机白名单在线引擎），默认预选上报机器

### FR-06: native 档不渲染选择器且仍锁原机
Given 系统就绪
When native 档不渲染选择器且仍锁原机
Then 行为符合本条标准描述

### FR-07: 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）
Given 系统就绪
When 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）
Then 行为符合本条标准描述

### FR-08: 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过
Given 系统就绪
When 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过滤）
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover_handoff.py::TestHandoffEndToEnd::test_provider_reselect_422_and_ok（含 openclaw 422 白名单断言）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx（白名单过滤用例：engines 恒白名单内）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py（四级矩阵零回归 15 用例）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：FR-01/03/04（runtime_id 显式/原机离线降级链）随用户裁决「不做任意机器」一并收窄不实施——原机匹配失败仍 409（D-002 不变），由 backend/app/modules/daemon/tests/test_takeover.py 四级矩阵既有覆盖。

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：两级机器选择器随用户裁决收窄不实施——仅引擎下拉（白名单过滤），见 FR-02 绑定。

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestTiersAndForkCreation::test_native_tier_resume_session_id_in_lease（native 锁原机+resume）+ session-panel-takeover.test.tsx native 用例（无选择器断言）。

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx（deriveTakeoverChrome 白名单过滤用例）+ backend test_takeover_handoff.py（openclaw 422「不支持会话」）。

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py + test_takeover_handoff.py（21 用例全绿）+ session-panel-takeover.test.tsx（7 用例全绿）；tsc/lint/mypy 零错。
