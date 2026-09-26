---
author: flow-machine-draft
created_at: 2026-09-26T14:45:56.806Z
---
# 需求规格（Requirements）— 2026-09-26-probe-concurrent-rpc

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加
Given 系统就绪
When 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加
Then 行为符合本条标准描述

### FR-02: probe_workspace_git_mode 与 git_remote_url 的 RPC 预算
Given 系统就绪
When probe_workspace_git_mode 与 git_remote_url 的 RPC 预算收紧为 3 秒，超时仍归 unknown
Then 行为符合本条标准描述

### FR-03: None（三态语义与 fail-safe 不变）
Given 系统就绪
When None（三态语义与 fail-safe 不变）
Then 行为符合本条标准描述

### FR-04: probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）
Given 端点 相关模块就绪
When probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）
Then 行为符合本条标准描述

### FR-05: 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法
Given 系统就绪
When 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法证明并发）与超时预算透传用例
Then 行为符合本条标准描述

### FR-06: 不改任何响应字段口径与既有日志事件语义
Given 系统就绪
When 不改任何响应字段口径与既有日志事件语义
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_git_probe_concurrent_not_serial（barrier 法：串行实现挂 3s 超时，并发实现 200）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_probe_and_remote_rpc_use_short_timeout_budget（stat/git_remote 两通道 timeout == _PROBE_RPC_TIMEOUT_SECONDS）
- backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py::TestProbeTriState::test_exists_true_dir_returns_git（delegate 层 send_rpc 收到短预算锚点）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_rpc_failure_returns_unknown_no_5xx（超时归 unknown 不 5xx，改造后语义不变）
- backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py::TestProbeUnavailable::test_rpc_timeout_returns_unknown

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_probe_and_remote_rpc_use_short_timeout_budget（git_remote 预取经端点全链路走通）
- backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_git_mode_repo_url_detected_and_backfilled（回填语义回归）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/workspace/tests/test_probe_endpoint.py（全量 15 passed：13 存量 + 2 新增）
- backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py（mock 契约同步后 9 passed）

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/workspace/tests/test_probe_endpoint.py::TestProbeEndpoint::test_batch_multi_workspaces_git_and_direct（响应字段/顺序/机器口径存量断言不改仍绿）
- backend/app/modules/agent/tests/test_mission_status.py + test_orchestrator.py（40 passed，collect_many 消费方零回归）
- 不适用（日志事件语义）：host_fs_rpc_failed 事件未改代码路径，由 test_rpc_failure_returns_unknown_no_5xx 的 warning 通道间接覆盖 -->
