---
author: qinyi
created_at: 2026-07-25 21:21:12
---

# 需求规格（Requirements）— daemon-borrow-for-business

## 角色

| 角色 | 说明 |
|---|---|
| 开发人员（lender / 出借人） | 有 daemon + 源码，主动把自己的 daemon 标记为工作空间共享 |
| 业务/管理人员（borrower / 借用方） | 无 daemon 无源码，business_member 角色，借用共享 daemon 跑 agent 出方案 |
| 工作空间 owner | 管理成员、查看/撤销共享 daemon、授予 business_member 角色 |

## 功能需求

### FR-01: daemon 共享标记（lender）
覆盖决策：D-003@v1, D-005@v1
Given 开发人员是某工作空间成员且已绑定自己的 daemon
When 开发人员调用 `PUT /workspaces/{ws}/my-binding/shared {shared:true}`
Then 该 binding 行 `shared=True`，可被同工作空间业务人员借用

Given shared 已为 true
When lender 设 `shared=false` 或解绑（删 binding 行）
Then 共享撤销，借用查询不再命中该 daemon

### FR-02: owner 管理共享 daemon
覆盖决策：D-003@v1
Given 工作空间存在共享 daemon
When owner 调用 `GET /workspaces/{ws}/shared-daemons`
Then 返回所有 shared daemon 列表（含 lender、在线状态、可撤销）

When owner 撤销某共享
Then 对应 binding `shared=false`

### FR-03: 业务人员借用权限 + 端点鉴权
覆盖决策：D-006@v2
Given owner 把某用户加为 business_member 角色（`task:run_agent` + `daemon:borrow` + workspace 读）
When 该用户（无自有 daemon）触发 agent run
Then 端点鉴权通过（`task:run_agent`），placement 发现无自有 daemon → 回退借用查询（需 `daemon:borrow`）

Given actor 无 `daemon:borrow` 权限
When 触发 agent run 且无自有 daemon
Then 报"工作区未绑定守护进程"（原行为，零回归）

### FR-04: 借用派发回退（4 路一致）
覆盖决策：D-002@v1, D-008@v1
Given actor 是 business_member，工作空间有 shared+online 的 daemon
When actor 触发 agent run（任意 SillySpec 阶段 / quick-chat）
Then 4 路 resolver（`_resolve_dispatch_runtime` / `_resolve_decide_runtime` / `resolve_runtime_for_writeback` / `prepare_interactive_dispatch._get_online_runtime`）统一回退到共享 daemon，建借用 lease 派发

Given 工作空间无 shared 或全离线
When actor 触发借用
Then 提示"工作空间无可用共享 daemon"

### FR-05: daemon 沙箱只读隔离
覆盖决策：D-007@v2, R-02
Given 借用 lease 派发到 lender daemon
When daemon 起 agent 进程
Then cwd=独立 sandbox（slug=`borrow-<actor>-<run>`），写策略按 lease 隔离只读 root_path，不命中 lender allowed_roots

Given 借用 agent 尝试写 lender 代码区
Then PolicyEngine 拒绝（写边界测试通过）

### FR-06: 方案落文件中心
覆盖决策：D-001@v1, D-009@v1, D-010@v1
Given 借用 agent run 完成（`close_interactive_run` / `complete_lease` 回调）
When backend 拿到方案文本
Then 调 `FileService.upload_file` 落 file（`owner_type=workspace`, `uploaded_by=borrower`），业务人员工作台可见

### FR-07: 借用审计
覆盖决策：D-004@v1
Given 每次借用发生
When lease 创建/完成
Then 写 `daemon_borrow_audit`（borrower / lender / daemon / workspace / agent_run / borrowed_at / usage）

## 非功能需求

- **兼容性**：`shared` 默认 false、`DAEMON_BORROW` 默认不授，未配置时所有现有行为不变（零回归）
- **可回退**：迁移可 down（删 shared 列 + 审计表 + 角色权限种子）
- **可测试**：每路 resolver 单测覆盖；写边界测试；借用查询三重校验测试
- **权限缓存**：grant `DAEMON_BORROW` 后触发 `invalidate_all_permissions`（对齐 `rbac-permission-cache` 变更）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-03, FR-06 | 方案落文件中心 |
| D-002@v1 | FR-04 | 自动借用 |
| D-003@v1 | FR-01, FR-02 | daemon 主人共享 + owner 撤销 |
| D-004@v1 | FR-07 | 审计不限额 |
| D-005@v1 | FR-01 | shared 列加到 member_runtimes |
| D-006@v2 | FR-03 | business_member 带 task:run_agent + daemon:borrow |
| D-007@v2 | FR-05 | 候选 B 按 lease 隔离只读 policy |
| D-008@v1 | FR-04 | 4 路 resolver 收敛 helper |
| D-009@v1 | FR-06 | FileService.upload_file |
| D-010@v1 | FR-06 | close_interactive_run/complete_lease 回调 |
