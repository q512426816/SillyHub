# 16 — RBAC 权限模型

## 1. 设计原则

```text
1. 权限点 = 字符串常量，禁止散落在代码字面量里，必须集中 enum
2. 角色 = 权限点的集合
3. 用户 = 在某 Workspace 下绑定 N 个角色
4. Agent = 也是 Actor，权限 = 任务 Owner 权限 ∩ Agent 权限模板（取交集）
5. 所有 API 必须用 Depends(require_permission(...)) 守护
6. 数据查询必须强制带 workspace_id 过滤
```

## 2. 权限点（七层）

```python
class Permission(str, Enum):
    # ── Platform ────────────────────────────────────────────
    PLATFORM_ADMIN = "platform:admin"
    PLATFORM_BILLING = "platform:billing"
    PLATFORM_AUDIT_READ = "platform:audit:read"

    # ── Workspace ───────────────────────────────────────────
    WORKSPACE_READ = "workspace:read"
    WORKSPACE_WRITE = "workspace:write"
    WORKSPACE_ADMIN = "workspace:admin"
    WORKSPACE_MEMBER_MANAGE = "workspace:member:manage"

    # ── Component ───────────────────────────────────────────
    COMPONENT_READ = "component:read"
    COMPONENT_WRITE = "component:write"
    COMPONENT_ADMIN = "component:admin"

    # ── Change ──────────────────────────────────────────────
    CHANGE_CREATE = "change:create"
    CHANGE_READ = "change:read"
    CHANGE_UPDATE = "change:update"
    CHANGE_APPROVE = "change:approve"
    CHANGE_ARCHIVE = "change:archive"

    # ── Task ────────────────────────────────────────────────
    TASK_CREATE = "task:create"
    TASK_ASSIGN = "task:assign"
    TASK_RUN_AGENT = "task:run_agent"
    TASK_CANCEL = "task:cancel"
    TASK_APPROVE = "task:approve"

    # ── Code ────────────────────────────────────────────────
    CODE_READ = "code:read"
    CODE_WRITE = "code:write"
    CODE_REVIEW = "code:review"
    CODE_MERGE = "code:merge"

    # ── Deploy ──────────────────────────────────────────────
    DEPLOY_STAGING = "deploy:staging"
    DEPLOY_PRODUCTION = "deploy:production"
    DEPLOY_ROLLBACK = "deploy:rollback"

    # ── Tool（Agent 工具调用） ─────────────────────────────
    TOOL_SHELL_EXEC = "tool:shell_exec"
    TOOL_NETWORK = "tool:network"
    TOOL_DATABASE = "tool:database"
    TOOL_SECRET_READ = "tool:secret:read"
```

## 3. 系统角色（V1 必有）

| Role key | 适用 | 包含权限 |
|---|---|---|
| `platform_admin` | 平台管理员 | 全部 |
| `workspace_owner` | Workspace 所有者 | workspace:* / component:* / change:* / task:* / code:review / deploy:staging |
| `component_lead` | 组件负责人 | component:read+write, change:read, task:assign, code:review |
| `developer` | 开发 | workspace:read, component:read, change:read, task:run_agent, code:read+write |
| `reviewer` | 评审 | workspace:read, change:read, code:read+review |
| `qa` | 测试 | workspace:read, change:read, code:read, task:run_agent (限 test 类) |
| `viewer` | 只读 | workspace:read, component:read, change:read |

## 4. Agent 权限模板（保留 risk-mitigation 原表）

```yaml
agent_permissions:
  business_agent:
    allow: [change:create, change:update, task:create]
    deny:  [code:write, deploy:*, tool:shell_exec]

  design_agent:
    allow: [change:create, change:update, code:read]
    deny:  [code:write, deploy:*, tool:shell_exec]

  coding_agent:
    allow: [code:read, code:write, code:review, task:run_agent, tool:shell_exec]
    deny:  [deploy:production, tool:database, tool:secret:read]

  testing_agent:
    allow: [code:read, code:review, tool:shell_exec]
    deny:  [code:write, deploy:*, change:approve]

  security_agent:
    allow: [code:read, code:review, change:read, task:approve]
    deny:  [code:write, deploy:*, change:update]

  devops_agent:
    allow: [deploy:staging, tool:shell_exec, tool:network]
    deny:  [deploy:production, code:write, change:update]

  review_agent:
    allow: [code:read, change:read, task:approve]
    deny:  [code:write, deploy:*, change:update]

  spec_guardian:
    allow: [change:read, code:read]
    deny:  [code:write, change:update, deploy:*]

  knowledge_agent:
    allow: [change:read, code:read]
    deny:  [code:write, change:update, deploy:*]

  coordinator_agent:
    allow: [task:assign, change:read]
    deny:  [code:write, deploy:*, change:approve]
```

**生效规则**：Agent 实际权限 = `agent_permissions[type].allow` ∩ `Task.owner` 的权限集合 - `deny` 列表。Agent 永远不能超过 Owner 权限。

## 5. 数据表

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE user_workspace_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id, role_id)
);
CREATE INDEX idx_uwr_user ON user_workspace_roles(user_id);
CREATE INDEX idx_uwr_workspace ON user_workspace_roles(workspace_id);

-- 组件级覆盖（可选）：在某个 component 上追加 / 禁用权限
CREATE TABLE user_component_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  component_id UUID NOT NULL REFERENCES project_components(id),
  added_permissions TEXT[] DEFAULT '{}',
  denied_permissions TEXT[] DEFAULT '{}',
  reason TEXT,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
```

## 6. 权限检查实现

```python
async def check_permission(
    user: User,
    permission: Permission,
    workspace_id: UUID,
    component_id: UUID | None = None,
    db: AsyncSession = ...,
) -> bool:
    if user.is_platform_admin:
        return True

    # 1. 收集 user 在 workspace 下所有角色权限
    perms = set(await db.scalar(text(
        """
        SELECT array_agg(DISTINCT rp.permission)
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON rp.role_id = uwr.role_id
        WHERE uwr.user_id = :uid AND uwr.workspace_id = :wid
        """
    ), {"uid": user.id, "wid": workspace_id}) or [])

    # 2. 应用 component override
    if component_id:
        ov = await db.execute(...)
        perms = (perms | set(ov.added)) - set(ov.denied)

    return permission.value in perms or "platform:admin" in perms
```

FastAPI 依赖：

```python
def require_permission(perm: Permission):
    async def _checker(
        user: User = Depends(get_current_user),
        workspace_id: UUID = Path(...),
        db: AsyncSession = Depends(get_db),
    ):
        ok = await check_permission(user, perm, workspace_id, db=db)
        if not ok:
            raise HTTPException(403, f"missing_permission:{perm.value}")
        return user
    return _checker
```

## 7. 跨 Workspace 隔离（必须）

所有业务表必须带 `workspace_id`，所有查询入口必须有 Mixin / Dependency 强制过滤：

```python
class WorkspaceScoped:
    @classmethod
    def query_scope(cls, db, workspace_id: UUID):
        return select(cls).where(cls.workspace_id == workspace_id)
```

V3 启用 Postgres Row Level Security：

```sql
ALTER TABLE changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON changes
  USING (workspace_id = current_setting('app.workspace_id')::uuid);
```

## 8. 危险操作二次确认

下列权限点即使有，调用时仍需二次审批：

- `deploy:production`
- `code:merge`（合并到 default branch）
- `workspace:admin` 下的删除操作
- `tool:database`
- `tool:secret:read`

## 9. V1 验收

- [ ] 角色种子数据自动建表后导入
- [ ] admin 能在 UI 给用户授予角色
- [ ] 普通用户访问无权限 API 返回 403 且事件入审计
- [ ] 修改角色权限即时生效（无需重新登录）
- [ ] Agent 执行时实际权限 ≤ Owner 权限（用单测覆盖）
