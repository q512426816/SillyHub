---
author: flow-machine-draft
created_at: 2026-10-12T06:43:13.857Z
---
# 需求规格（Requirements）— 2026-10-12-run-level-change-attribution

## 功能需求

### FR-01: 会话轮消息中出现 sillyspec run/flow --change 命令后，平台记录会话级「当前变更上下文」（agent_sessions 新列），后续新开轮（inject）创建的 AgentRun.change_id 记为该上下文

- 会话（AgentSession）必须新增「当前变更上下文」持久列：会话轮次消息中被解析出 sillyspec 绑定命令（`sillyspec run --change X` / `sillyspec flow start|done|amend-draft --change X`）时，服务端必须把该列更新为该命令指向的变更；同一批消息出现多条绑定命令时以消息序最后一条为准。
- 后续新开轮（`inject` 路径创建的 AgentRun）创建时必须把 `change_id` 记为会话当前上下文；上下文为空时 `change_id` 保持 NULL（现状行为）。
- 会话首建路径（create_session）产生的首 run 不在本条范围：其 `change_id` 语义由既有派发参数决定，本变更禁止改动。
- 历史存量轮（打锚机制上线前创建）禁止回填——不做数据迁移改写存量 `agent_runs.change_id`。

#### 场景：主路径

- Given 会话 S 的当前上下文为变更 X（前序轮执行过 `flow start --change X` 并已被 run_sync 通道回写），When 用户发起新一轮触发 inject，Then 新建 AgentRun 的 `change_id == X.id`。
- Given 会话 S 从未出现任何 sillyspec 绑定命令（上下文列为 NULL），When inject 新开轮，Then 新建 AgentRun 的 `change_id` 为 NULL，行为与改动前一致。

#### 场景：切换

- Given 会话上下文为 X，When 某轮消息先后出现 `flow done --change X` 与 `flow start --change Y`，Then 上下文最终为 Y（最后一条生效），且「执行 start Y 命令的那一轮」仍按其创建时的上下文归属（X）——允许 ≤1 轮的切换误差，与本地 CLI 水位 ~10s 粒度同级。

### FR-02: bind_session_to_change 返回变更 id 供 run_sync 通道回写上下文；platform_sync agent-logs 通道绑定行为不变

- `bind_session_to_change` 必须返回本次绑定（或已存在的 link）对应的变更行 id（UUID）；绑定被 default 伪键守卫跳过或整体失败时返回 None。
- 既有调用方中仅 run_sync 交互通道（submit_commit）消费返回值回写会话上下文；platform_sync agent-logs 通道（W2.2）调用该函数后的绑定行为（link 行落库、placeholder 创建、default 守卫、savepoint 不 commit）必须与改动前逐字节一致，且禁止在 platform_sync 通道回写会话上下文（该通道面向本地 CLI 日志，会话对象可能是 tool_report 聚合会话，语义不同）。

#### 场景：主路径

- Given workspace 内已有变更 X，When 以 change_key=X 调用 `bind_session_to_change`，Then 返回 X 的 id 且 `change_session_links` 落行（幂等重入返回同一 id）。
- Given change_key="default"，When 调用 `bind_session_to_change`，Then 返回 None 且不落任何行（守卫行为不变）。

### FR-03: 变更用量聚合口径调整：带 change_id 的 run 独占归该变更；change_session_links 会话链路只认领 change_id 为空的 run（存量无锚 run 行为不变，防回归）

- 变更执行用量聚合（详情与列表摘要同一口径）中，带 `change_id` 的 run 必须只归其锚定的变更：会话链接分支必须排除 `change_id` 非空的 run（`IS NULL` 谓词），使打锚 run 不再经共享会话重复摊给其它绑定变更。
- 无锚 run（`change_id IS NULL`）在会话链接分支的认领行为必须与改动前一致——存量会话（全部 run 无锚）的统计数字禁止因本变更变化（防回归）。
- 快速修复（quicklog）聚合口径禁止改动（quicklog 走本地 CLI 链路，无轮级锚概念）。

#### 场景：主路径

- Given 会话 S 同时链接变更 X 与 Y，S 含 run r1(change_id=X)、r2(change_id=NULL)，When 聚合 X 与 Y 的执行用量，Then r1 只计入 X；r2 经会话链接同时计入 X 与 Y（现状口径）。
- Given 存量会话全部 run 的 change_id 均为 NULL，When 聚合其绑定变更用量，Then 结果与改动前一致（回归护栏）。

### FR-04: 同一会话先后执行两个变更（打锚后）时，两个变更的执行用量统计互不相同且各只含自己时段的轮

- 同一会话先后执行两个变更、各时段轮均已打锚时，两个变更的执行用量统计（列表摘要与详情端点同口径）必须互不相同，且各自必须只含自己锚定轮的用量——除两端各自恰为空集的退化情形外，禁止再把会话总和原样显示在每个变更行。

#### 场景：主路径

- Given 会话先执行变更 X（其时段轮 r1 打锚 X）再执行变更 Y（其时段轮 r2 打锚 Y），When 分别查询 X、Y 的执行用量，Then X 的统计只含 r1 时段的轮、Y 的统计只含 r2 时段的轮，两者 token/轮次/耗时互不相同。

#### 场景：主路径

- Given 同会话两变更各至少一个打锚 run 且 token 用量不同，When 查询两变更用量，Then 两变更 totals 互不相等且各自等于自己锚定 run 之和。

### FR-05: 既有 usage_stats 与相关 binding 测试全部通过，并新增打锚与聚合拆分用例

- 本变更合并后，既有 `test_usage_stats.py`、`test_spec_binding.py` 及 inject 相关测试必须全部通过（禁止为通过而修改测试语义，非测试逻辑有误除外）；必须新增覆盖以下面的用例：bind 返回值契约（FR-02）、inject 打锚（FR-01）、聚合拆分与回归护栏（FR-03/FR-04）。

#### 场景：主路径

- When 运行本变更相关测试文件（usage_stats / spec_binding / inject 打锚新用例），Then 全部通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_inject_change_context.py「inject 轮打锚会话当前变更上下文」
FR-02: backend/app/modules/change/tests/test_spec_binding.py「bind_session_to_change 返回变更 id（含 default 守卫返回 None）」
FR-03: backend/app/modules/change/tests/test_usage_stats.py「打锚 run 独占归锚定变更 + 存量无锚 run 行为不变」
FR-04: backend/app/modules/change/tests/test_usage_stats.py「同会话先后两变更用量互不相同各归各段」
FR-05: backend/app/modules/change/tests/test_usage_stats.py + test_spec_binding.py + test_inject_change_context.py「全量通过」
