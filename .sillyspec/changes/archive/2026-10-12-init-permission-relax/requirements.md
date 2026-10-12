---
author: flow-machine-draft
created_at: 2026-10-12T06:19:08.221Z
---
# 需求规格（Requirements）— 2026-10-12-init-permission-relax

背景：生产实证（request_id 62c277ac，2026-10-12）——spdemo 工作区的 developer
成员 181144 发起 `POST /api/workspaces/{id}/init` 被拒 403（缺
workspace:write）。init 的语义是"为当前成员初始化本地环境"（D-002/D-009：
向成员自己的 daemon 派发 init lease、写成员本地项目目录），开发者恰恰是
需要它的日常角色。用户裁决放宽权限；本变更修订
2026-08-14-security-audit-remediation FR-09 的权限档位，保留其工作区隔离意图。

## 功能需求

### FR-01: POST /api/workspaces/{id}/init 的权限门从 WORKSPACE_WRITE 改为 WORKSPACE_READ,仍 workspace-scoped

init 端点的权限依赖必须从 `require_permission(Permission.WORKSPACE_WRITE)`
改为 `require_permission(Permission.WORKSPACE_READ)`，且必须保持
workspace-scoped 判定（按 `{workspace_id}` 路径参数解析角色权限）；
禁止改为全局任意权限判定。

#### 场景：权限档位替换

- Given 路由声明面
- When 检查 `/{workspace_id}/init` 端点的依赖
- Then 权限依赖为 workspace-scoped `WORKSPACE_READ`

### FR-02: 本工作区成员(含 developer 等只读角色)发起 init 不再 403,无 daemon 绑定时走既有 409 MemberBindingNotFound 业务路径

持有本工作区任意成员角色（含仅 `workspace:read` 的 developer/viewer 等）
的用户发起 init 必须通过权限门进入服务层；无 daemon 绑定时必须返回既有
409 `MemberBindingNotFound` 业务错误，禁止再以 403 权限拒绝。

#### 场景：developer 成员无 daemon 绑定发起初始化

- Given 用户通过角色绑定为本工作区成员，角色仅有 `workspace:read` 权限点，且无成员 daemon 绑定
- When POST /api/workspaces/{id}/init
- Then 返回 409（MemberBindingNotFound 语义），不是 403

### FR-03: 非本工作区成员发起 init 仍 403(FR-09 隔离意图不回退)

不在本工作区持有任何成员角色的用户发起 init 必须仍被 403 拒绝；
FR-09 的 workspace 隔离意图禁止回退（即便用户在其它工作区持有写权限）。

#### 场景：非成员发起初始化

- Given 用户不属于目标工作区（无任何 UserWorkspaceRole 绑定）
- When POST /api/workspaces/{id}/init
- Then 返回 403，details 含 permission 与 workspace_id

### FR-04: workspace activate 端点不动(仍是 WORKSPACE_WRITE,本次仅放宽 init)

`POST /api/workspaces/{id}/activate` 的权限依赖必须保持
`WORKSPACE_WRITE` 不变；本变更禁止触碰 activate 的鉴权面。

#### 场景：activate 端点不受影响

- Given 路由声明面
- When 检查 `/{workspace_id}/activate` 端点的依赖
- Then 权限依赖仍为 workspace-scoped `WORKSPACE_WRITE`

### FR-05: 先写失败测试(developer 409 而非 403 / 非成员仍 403)再改实现,相关 pytest 全绿

必须先写覆盖 FR-02/FR-03 的失败用例（developer 成员期望 409、非成员期望
403），在旧实现下确认先红（developer 用例得 403）再改实现转绿；
完成后相关 pytest 必须全绿。

#### 场景：先红后绿

- Given 新增的 init 权限测试文件
- When 旧实现下运行 developer 用例
- Then 失败（得到 403）；实现改为 WORKSPACE_READ 后同一用例通过（得到 409）

### FR-06: 接口契约无 DTO 变化,无需重生成 api-types

本变更禁止改动任何请求/响应 DTO 与 OpenAPI schema；响应结构必须与变更前
逐字段一致（错误路径的 code/message 由既有异常体系决定）。

#### 场景：契约零变化

- When 对比变更前后的 openapi.json
- Then 无差异（不重生成 api-types）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/workspace/test_init_permission.py「test_init_developer_member_without_binding_gets_409_not_403」
FR-02: backend/tests/modules/workspace/test_init_permission.py「test_init_developer_member_without_binding_gets_409_not_403」
FR-03: backend/tests/modules/workspace/test_init_permission.py「test_init_non_member_still_403」
FR-04: backend/tests/modules/workspace/test_init_permission.py「test_activate_still_requires_write_non_member_403」
FR-05: backend/tests/modules/workspace/test_init_permission.py「全文件先红后绿」
FR-06: 不适用：纯权限门替换无契约面，由既有路由响应结构不变性保证
