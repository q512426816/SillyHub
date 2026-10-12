---
author: flow-machine-draft
created_at: 2026-10-12T00:20:58.110Z
---
# 需求规格（Requirements）— 2026-10-12-task-sweep-rpc-route-key

## 功能需求

### FR-01: sweep_confirmed_dead_tasks 对每个候选 runtime 先经 _resolve_daemon_id_for_runtime 映射出 daemon 路由键再发 session_live_tasks RPC；runtime 行缺失时该 runtime 的候选跳过（fail-open 保活）；daemon_instance_id 为 NULL（D-007 迁移窗）沿用 helper 既有语义回落 runtime_id 作路由键

- 确认制清扫向 daemon 发 `session_live_tasks` RPC 时，必须以 `_resolve_daemon_id_for_runtime` 解析出的 daemon 路由键为 `hub.send_rpc` 第一参，禁止直接使用 `AgentSession.runtime_id` 原值（WS Hub 连接表按 daemon_instance_id 注册，两个 UUID 空间不同）。
- runtime 行已不存在（helper 返 None）时，该 runtime 名下全部候选必须跳过不收口（与 daemon 离线同语义，fail-open 保活），且不得发送 RPC。
- `daemon_instance_id` 为 NULL 的 legacy 行（D-007 迁移窗）必须沿用 helper 既有回落语义，以 runtime_id 本身作路由键。

#### 场景：绑定 instance 的 runtime 按映射键路由

- Given runtime 行 `daemon_instance_id=I`（I≠runtime_id），其活跃会话下有非终态任务行
- When 执行 `sweep_confirmed_dead_tasks`
- Then `hub.send_rpc` 收到的路由键为 I 而非 runtime_id

#### 场景：runtime 行缺失跳过

- Given AgentSession.runtime_id 指向不存在的 runtime 行，会话状态 active
- When 执行清扫
- Then 不发 RPC、该候选行保持 running（不误收）

#### 场景：legacy NULL 回落不变

- Given runtime 行 `daemon_instance_id=None`（既有夹具形态）
- When 执行清扫
- Then RPC 路由键为 runtime_id 本身（既有 5 用例口径不变）

### FR-02: 新增用例：runtime 绑定 daemon_instance_id 后 send_rpc 收到的路由键为 daemon_instance_id 而非 runtime_id（先红后绿）；既有清扫用例语义不变全绿

- 测试必须存在断言「send_rpc 第一参 == daemon_instance_id」的用例，且在修复前为红、修复后为绿；既有清扫行为用例（确认收口/离线跳过/终态直收/run 限定/竞态守卫/复活）必须保持全绿，不得为通过而改语义。

#### 场景：路由键断言用例

- Given 夹具建 daemon_instance + 绑定它的 runtime + 活跃会话与任务行
- When 以按 (路由键, session_id) 脚本化的桩 hub 执行清扫
- Then 桩记录的调用键为 instance id，且 daemon 报活的任务行保持 running

### FR-03: 启动清扫从 lifespan 同步 await 改为延迟后台任务（对齐 _recheck_stale_runs_loop 模式：独立 session、强引用防 GC、done 回收异常），给 daemon 留重连窗口后再确认，异常不阻断启动

- 启动确认清扫必须以延迟后台协程执行（延迟常量默认 60 秒，给 daemon WS 重连留窗口），禁止在 `cleanup_stale_runs` 内同步 await 阻断 lifespan；任务必须自开独立 session（`get_session_factory()`），必须被强引用持有防 GC 并经 `_on_background_task_done` 回收；任务内任何异常必须记日志返回、禁止向外抛出阻断启动。

#### 场景：延迟任务在独立 session 上执行清扫

- Given 延迟常量被置 0、`sweep_confirmed_dead_tasks` 被替身为记录调用的桩
- When await `_startup_orphan_task_sweep`
- Then 桩被调用恰好一次，且传入的 session 非 cleanup_stale_runs 的调用方 session

#### 场景：清扫异常不冒泡

- Given 替身桩抛 RuntimeError
- When await `_startup_orphan_task_sweep`
- Then 协程正常返回不抛异常（日志留痕）

### FR-04: 仅跑本改动相关测试（规则 0）：test_agent_session_tasks.py 全文件

- 本变更只必须运行 `backend/app/modules/daemon/tests/test_agent_session_tasks.py` 全文件（含既有清扫用例回归），禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行该测试文件
- Then 新增用例与既有用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_routes_rpc_by_daemon_instance_id」
FR-02: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_routes_rpc_by_daemon_instance_id」
FR-03: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_startup_orphan_task_sweep_deferred_on_own_session」「test_startup_orphan_task_sweep_swallows_errors」
FR-04: backend/app/modules/daemon/tests/test_agent_session_tasks.py（全文件回归，含既有清扫用例）
