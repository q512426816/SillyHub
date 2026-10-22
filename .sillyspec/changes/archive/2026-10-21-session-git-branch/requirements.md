---
author: flow-machine-draft
created_at: "2026-10-21T14:35:37.254Z"
---
# 需求规格（Requirements）— 2026-10-21-session-git-branch

## 功能需求

### FR-01: 会话组件底部「智能体档案」后面展示该会话当前所在 git 分支

- 已创建的真会话（sessionId 非空）打开时，会话配置条（SessionConfigBar）「智能体档案」控件之后**必须**渲染 git 分支指示项：显示该会话工作目录（`AgentSession.cwd`，为空时回退所属工作区的成员绑定根路径）的**当前** git 分支名；detached HEAD 时**必须**显示 head 短 sha 标识；预会话（无 sessionId）不渲染；mobile 显隐遵循档案控件同款规则。

#### 场景：主路径

- Given 已创建的会话（cwd 指向 git 仓库、当前分支 feature-x）When 用户打开会话面板 Then 配置条「智能体档案」后显示 ⎇ feature-x
- Given 会话 cwd 处于 detached HEAD When 打开会话面板 Then 显示 head 短 sha（非空分支名）

### FR-02: 分支信息为实时查询（非创建时快照）：会话运行期间分支变化后，展示随之更新（轮询刷新）

- 分支数据**必须**来自每次请求的实时查询链路（新端点 `GET /api/daemon/sessions/{id}/git-status` → daemon `git_status` RPC 现场执行），**禁止**使用会话创建时落库的静态快照字段；前端**必须**以 ≤60s 间隔轮询该端点刷新展示（仅页面可见时轮询，后台标签页暂停），会话工作目录切换分支后展示随之变化。

#### 场景：分支切换后自动更新

- Given 会话面板已打开、指示项显示分支 A When 该会话工作目录切到分支 B Then ≤60s 内指示项更新为 B（无需手动刷新页面）

### FR-03: 无 git 仓库/无 cwd 的会话有优雅降级展示，不报错

- 会话无 cwd 且无所属工作区、或目录非 git 仓库时，端点**必须**返回 200 空态（git_mode=no_root / no_git，branch 等字段为 null），前端指示项**必须**静默隐藏（不渲染、不抛错、不弹 toast）；daemon 离线等查询失败时指示项**必须**降级为占位形态（如「⎇ —」），**禁止**因本指示项失败阻塞配置条其余控件。

#### 场景：空态与故障

- Given 会话无 cwd 且无 workspace_id When 请求 git-status Then 200 {git_mode: "no_root"}，前端不渲染指示项
- Given 会话 cwd 非 git 仓库 When 请求 git-status Then 200 {git_mode: "no_git"}，前端不渲染指示项
- Given daemon 离线 When 请求 git-status Then 非 2xx（502 族），前端指示项降级占位、其余控件不受影响

### FR-04: 工作区顶部既有 GitStatusBar 行为不变

- 工作区会话页顶部 GitStatusBar 的取数端点、缓存节奏与渲染**必须**保持不变；本变更**禁止**改动 `/api/workspaces/{wid}/git-log/*` 端点、`useGitLogStatus` 与 `GitStatusBar` 组件。

#### 场景：零回归

- Given 本变更合入 When 打开工作区会话页 Then 顶部 GitStatusBar 行为与合入前一致（既有 git_log 测试面全绿）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_returns_branch_from_session_cwd」
FR-01: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「renders git branch indicator after profile control」
FR-02: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_queries_daemon_rpc_per_request_no_snapshot」
FR-02: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「git branch indicator polls with refetchInterval」
FR-03: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_no_root_and_no_git_empty_states」
FR-03: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「hides git branch indicator on no_git / no_root」
FR-04: 不适用：纯零回归约束——本变更不触碰 git-log 端点/useGitLogStatus/GitStatusBar，由既有 git_log 测试面（backend/app/modules/git_log/tests/）守护，无新增行为面可测
