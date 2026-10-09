---
author: flow-machine-draft
created_at: 2026-10-09T15:01:05.475Z
---
# 需求规格（Requirements）— 2026-10-09-daemon-page-stable-sort

## 功能需求

### FR-01: /machines 机器列表排序稳定：保留 online 优先，其余改为展示名（coalesce(display_alias, hostname)）升序 + id 兜底，连续多次刷新顺序不变

- 后端 `list_machines` 主查询必须按「online 优先 → 展示名 `coalesce(display_alias, hostname)` 升序 → `id` 升序」排序，禁止再以 `last_heartbeat_at` 作为机器列表排序键（每次心跳都更新该字段，导致前端 15s 轮询刷新时机器卡顺序乱跳）。

#### 场景：机器卡顺序不随心跳翻转

- Given 同一用户两台 online 机器 A、B，A 的心跳时间比 B 新
- When 前端连续两次调用 GET /api/daemon/machines（期间 A、B 均有新心跳，先后次序互换）
- Then 两次响应中 items 的机器顺序一致，均按展示名升序排列

#### 场景：online 优先保留

- Given 一台 offline 机器（即使心跳时间最新）与多台 online 机器
- When 调用 GET /api/daemon/machines
- Then online 机器全部排在 offline 机器之前，组内按展示名升序

#### 场景：别名参与排序

- Given 机器 hostname 为 "zeta-host"，display_alias 为 "alpha 别名"
- When 调用 GET /api/daemon/machines
- Then 该机器按 "alpha 别名"（而非 hostname）参与排序位置计算，与卡片头展示名一致

### FR-02: 机器内 runtime（agent）列表排序稳定：provider 升序 + created_at/id tiebreaker，同 provider 多 agent 顺序不变

- `list_machines` 的嵌套 runtimes 二次查询必须按「provider 升序（NULL 靠后）→ `created_at` 升序 → `id` 升序」排序，保证同 provider 多个 agent（runtime 卡）在多次刷新间顺序固定。

#### 场景：同 provider 多 agent 顺序固定

- Given 一台机器下两个 provider 均为 "claude" 的 runtime，created_at 先后不同
- When 连续两次调用 GET /api/daemon/machines
- Then 该机器嵌套 runtimes 数组中两个 claude runtime 的先后顺序两次一致（按 created_at 升序）

### FR-03: 共享给我的区块内 runtimes 明细同口径加 tiebreaker

- `grants/queries.list_machines_shared_to_me` 的 runtimes 明细二次查询必须在既有 `daemon_instance_id, provider` 排序后追加 `created_at, id` tiebreaker，保证「共享给我的」区块内 agent 明细顺序在多次刷新间固定。

#### 场景：共享机器 agent 明细顺序固定

- Given 一台共享机器下两个同 provider 的 runtime
- When 连续两次调用 GET /api/daemon/machines
- Then 响应 shared_to_me 块中该机器 runtimes 明细顺序两次一致

### FR-04: 新增/扩展后端测试覆盖上述排序稳定性，相关既有测试全部通过

- 本变更必须新增覆盖 FR-01/02/03 排序稳定性的后端测试，并同步更新既有排序断言（`test_machines_sort_online_first_then_heartbeat_desc` 断言的是被本变更废止的旧排序键），本变更触达的模块测试必须全部通过；禁止跑全量测试（CI 负责）。

#### 场景：排序行为有回归保护

- Given 排序实现被误改回按 last_heartbeat_at 排序
- When 运行 test_machines_router.py 排序用例
- Then 用例失败（断言展示名升序与心跳无关）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_sort_online_first_then_display_name_asc」
FR-02: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_nested_runtimes_same_provider_stable_order」
FR-03: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_shared_to_me_runtimes_same_provider_stable_order」
FR-04: backend/app/modules/daemon/tests/test_machines_router.py「test_machines_sort_online_first_then_display_name_asc + test_machines_nested_runtimes_same_provider_stable_order + test_machines_shared_to_me_runtimes_same_provider_stable_order」
