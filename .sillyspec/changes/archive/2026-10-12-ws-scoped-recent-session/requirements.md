---
author: flow-machine-draft
created_at: 2026-10-12T07:27:53.013Z
---
# 需求规格（Requirements）— 2026-10-12-ws-scoped-recent-session

## 功能需求

### FR-01: workspace/change/quicklog 三种 scope 入口的「继续最近会话」只取本工作区（workspace_id 过滤后 last_active_at 优先）的最近会话

- workspace/change/quicklog 三种 scope 入口下，空门户「继续最近会话」必须只从 workspace_id 等于 scope.workspaceId 的会话中按 last_active_at（缺省回退 created_at）降序取第一条；禁止展示或选中其他工作区的会话。

#### 场景：跨工作区取最近

- Given：门户 sessions（useDaemonMachines 旁路，全局最近 100 条未归档）同时含 B 工作区最近会话（last_active_at 更新）与 A 工作区会话；
- When：以 workspace scope（workspaceId=A）渲染空门户；
- Then：「继续最近会话」按钮显示 A 的会话标题，点击直达选中 A 会话（selectedWorkspaceId 快照=A）。

### FR-02: 全局 /sessions（无 scope）行为不变，仍取全局最近会话

- 不传 scope 的全局门户必须保持现状：从全部 sessions 按同一排序取全局最近一条（含任意工作区/非工作区会话），禁止因本变更引入过滤。

#### 场景：全局门户不受影响

- Given：sessions 含跨工作区多条会话，全局最近一条属 B 工作区；
- When：无 scope 渲染 /sessions 空门户；
- Then：「继续最近会话」仍取 B 的最近会话（既有 ql-20260910-002 用例锁定）。

### FR-03: 本工作区无会话（或未进全局前 100）时按钮不渲染，沿用 null 不渲染契约

- scope 入口下本工作区过滤后无会话时，recentSession 必须为 null，空门户禁止渲染「继续最近会话」按钮——沿用既有「无会话不渲染入口」契约（少显示而非错显示）。

#### 场景：本工作区无会话

- Given：sessions 仅含 B 工作区会话（或本工作区会话未进全局前 100）；
- When：以 workspace scope（workspaceId=A）渲染；
- Then：门户空态正常渲染但「继续最近会话」按钮不出现。

### FR-04: resolveDefaultMachineId 默认机器解析仍用全局 sessions，语义不变

- ?new=1 直达新建的默认机器三级回退（resolveDefaultMachineId）必须继续消费未过滤的全局 sessions——默认机器是「用户最近所用机器」的用户偏好语义，机器不隶属工作区，禁止随本变更为其引入 scope 过滤。

#### 场景：默认机器解析不变

- Given：门户带 includeSessions 拉取全局 sessions；
- When：?new=1 直达新建触发默认机器解析；
- Then：三级回退（localStorage 上次选择 → 全局最近会话所在在线机器 → 最新心跳在线机器）行为与本变更前一致（既有 resolveDefaultMachineId 用例锁定）。

### FR-05: 测试覆盖：scope 入口最近会话属其他工作区时取本工作区会话或隐藏按钮；全局门户不受影响

- 必须新增测试用例锁定：scope 入口全局最近会话属其他工作区时按钮取本工作区最近会话（含点击直达选中）；本工作区无会话时按钮不渲染；全局门户行为由既有 ql-20260910-002 用例继续锁定。

#### 场景：主路径

- Given：sessions-portal.test.tsx 既有 mock 基建（machinesHook 可控 sessions）；
- When：新增用例以 WORKSPACE_SCOPE 渲染并覆写 sessions；
- Then：断言按钮文案取本工作区会话 / 按钮不存在，且既有全局用例不回归。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「scope 入口最近会话属其他工作区时按本工作区取（workspace/change/quicklog 三入口）」
FR-02: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「ql-20260910-002 门户带 includeSessions 拉取 + 继续最近会话直达选中并落工作区快照」
FR-03: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「scope 入口本工作区无会话时不渲染继续最近会话入口」
FR-04: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「resolveDefaultMachineId 三级回退既有用例（localStorage 命中/最近会话所在机器/最新心跳）——语义照旧回归锁定」
FR-05: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「scope 入口最近会话属其他工作区时按本工作区取（workspace/change/quicklog 三入口）」+「scope 入口本工作区无会话时不渲染继续最近会话入口」
