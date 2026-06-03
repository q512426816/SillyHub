# 17 — 数据库 Schema 总表

> 本文档是平台所有持久化表的总览。每个版本（V1/V2/V3/V4/V5）只引入对应阶段需要的表。Alembic migration 必须可回滚。

## 1. 约定

- DBMS：PostgreSQL 16+
- 主键：`UUID v4`，列名 `id`，默认 `gen_random_uuid()`
- 时间戳：`TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- 软删除：`deleted_at TIMESTAMPTZ NULL`（不用 `is_deleted`）
- JSONB：复杂结构统一用 `JSONB`，配 GIN 索引
- 命名：表名小写复数 + 下划线，字段同
- 外键：业务表必须带 `workspace_id`，所有查询入口强制过滤
- 索引前缀：`idx_<table>_<column>`

## 2. V1 必建表

### 2.1 用户与认证（见 references/15）

```sql
-- users, sessions, login_attempts （略，详见 15-authentication.md）
```

### 2.2 角色与权限（见 references/16）

```sql
-- roles, role_permissions, user_workspace_roles, user_component_overrides
```

### 2.3 Workspace 与 ProjectComponent

```sql
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  root_path TEXT NOT NULL,             -- 仓库本地路径
  sillyspec_path TEXT NOT NULL,        -- 通常 root_path + '/.sillyspec'
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  UNIQUE(root_path),
  UNIQUE(slug)
);

CREATE TABLE project_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  component_key VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50),                    -- frontend / backend / tooling / docs / test
  role VARCHAR(50),
  path TEXT,                           -- 组件相对 root_path 的路径
  repo_url TEXT,
  default_branch VARCHAR(100) DEFAULT 'main',
  tech_stack JSONB DEFAULT '[]'::jsonb,
  build_command TEXT,
  test_command TEXT,
  source_yaml_path TEXT NOT NULL,      -- .sillyspec/projects/xxx.yaml
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, component_key)
);
CREATE INDEX idx_components_workspace ON project_components(workspace_id);

CREATE TABLE component_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_component_id UUID NOT NULL REFERENCES project_components(id),
  target_component_id UUID NOT NULL REFERENCES project_components(id),
  relation_type VARCHAR(50) NOT NULL,  -- consumes_api_from / depends_on / tests / publishes_to
  description TEXT,
  UNIQUE(source_component_id, target_component_id, relation_type)
);

CREATE TABLE scan_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
  doc_type VARCHAR(30) NOT NULL,       -- ARCHITECTURE / CONVENTIONS / CONCERNS / INTEGRATIONS / PROJECT / STRUCTURE / TESTING
  path TEXT NOT NULL,
  title VARCHAR(500),
  exists BOOLEAN NOT NULL DEFAULT true,
  last_modified_at TIMESTAMPTZ,
  UNIQUE(component_id, doc_type)
);
```

### 2.4 Change / Task / Runtime

```sql
CREATE TABLE changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  change_key VARCHAR(200) NOT NULL,    -- 即目录名，如 2026-05-25-xxx
  title VARCHAR(500),
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  location VARCHAR(20) NOT NULL CHECK (location IN ('active', 'archive')),
  path TEXT NOT NULL,                  -- .sillyspec/changes/{location}/xxx
  affected_components JSONB DEFAULT '[]'::jsonb,
  change_type VARCHAR(50),
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE(workspace_id, change_key)
);
CREATE INDEX idx_changes_workspace ON changes(workspace_id, location, status);

CREATE TABLE change_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id UUID NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  doc_type VARCHAR(30) NOT NULL,       -- MASTER / proposal / requirements / design / plan / tasks / verification / prototype / reference
  path TEXT NOT NULL,
  exists BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(30),
  last_modified_at TIMESTAMPTZ,
  UNIQUE(change_id, doc_type, path)
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  change_id UUID NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  task_key VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  owner_id UUID REFERENCES users(id),
  priority VARCHAR(10),
  affected_components JSONB DEFAULT '[]'::jsonb,
  allowed_paths JSONB DEFAULT '[]'::jsonb,
  path TEXT NOT NULL,                  -- tasks/task-xx.md
  estimated_hours INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(change_id, task_key)
);
CREATE INDEX idx_tasks_owner_status ON tasks(owner_id, status);
CREATE INDEX idx_tasks_change ON tasks(change_id);

CREATE TABLE runtime_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  progress_json JSONB,
  user_inputs_md TEXT,
  artifacts JSONB DEFAULT '[]'::jsonb,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.5 Git Identity / Worktree / Git 操作日志

```sql
CREATE TABLE git_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL,       -- github / gitlab / gitea / generic
  git_username VARCHAR(200),
  git_email VARCHAR(200),
  credential_type VARCHAR(20) NOT NULL CHECK (credential_type IN ('pat','oauth','ssh_key','app')),
  encrypted_credential BYTEA NOT NULL,
  key_id VARCHAR(50) NOT NULL,         -- 主密钥版本号（用于轮换）
  allowed_repositories JSONB DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_git_identities_user ON git_identities(user_id, revoked_at);

CREATE TABLE worktree_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  component_id UUID NOT NULL REFERENCES project_components(id),
  change_id UUID NOT NULL REFERENCES changes(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  user_id UUID NOT NULL REFERENCES users(id),
  run_id UUID NOT NULL,
  path TEXT NOT NULL UNIQUE,
  branch_name VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'locked',  -- locked / released / expired
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_worktree_active ON worktree_leases(task_id, status);
CREATE INDEX idx_worktree_expires ON worktree_leases(status, expires_at);

CREATE TABLE git_operation_logs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID,
  component_id UUID,
  change_id UUID,
  task_id UUID,
  run_id UUID,
  user_id UUID NOT NULL,
  git_identity_id UUID NOT NULL,
  operation VARCHAR(50) NOT NULL,
  branch_name VARCHAR(500),
  commit_sha VARCHAR(40),
  success BOOLEAN NOT NULL,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_gitlog_task_time ON git_operation_logs(task_id, created_at DESC);
CREATE INDEX idx_gitlog_user_time ON git_operation_logs(user_id, created_at DESC);
```

### 2.6 审计事件

```sql
CREATE TABLE audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,    -- USER_ACTION / AGENT_ACTION / TOOL_CALL / SPEC_CHANGE / CODE_CHANGE / APPROVAL_ACTION / PERMISSION_CHANGE / DEPLOYMENT_ACTION / MODEL_CALL / SECRET_ACCESS / AUTH_*
  actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id VARCHAR(100) NOT NULL,     -- user uuid 或 agent_type:run_id
  workspace_id UUID,
  change_id UUID,
  task_id UUID,
  run_id UUID,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_task ON audit_events(task_id, created_at DESC);
CREATE INDEX idx_audit_type ON audit_events(event_type, created_at DESC);
CREATE INDEX idx_audit_workspace ON audit_events(workspace_id, created_at DESC);
CREATE INDEX idx_audit_payload_gin ON audit_events USING GIN (payload);
```

## 3. V2 追加表（平台写入 Change）

```sql
CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(50) NOT NULL, -- 'change' / 'task' / 'doc'
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox(status, next_retry_at) WHERE status = 'pending';
```

## 4. V3 追加表（审批与状态机）

```sql
CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  target_type VARCHAR(30) NOT NULL,   -- change / task / deploy / git_merge / tool_call
  target_id UUID NOT NULL,
  reason VARCHAR(200),
  payload JSONB DEFAULT '{}'::jsonb,
  required_approvals INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending / approved / rejected / expired
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE TABLE approval_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approve','reject','request_changes')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE task_status_log (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  changed_by VARCHAR(100) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trace_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_type VARCHAR(30) NOT NULL,   -- spec / task / commit / test / deploy
  source_id VARCHAR(100) NOT NULL,
  target_type VARCHAR(30) NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  link_type VARCHAR(30) NOT NULL,     -- implements / tests / approves / deploys / changes
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, source_type, source_id, target_type, target_id, link_type)
);
```

## 5. V4 追加表（Agent 执行）

```sql
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  user_id UUID NOT NULL REFERENCES users(id),
  agent_type VARCHAR(30) NOT NULL,    -- claude_code / codex / cursor / shell
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / running / success / failed / cancelled / timeout
  worktree_lease_id UUID REFERENCES worktree_leases(id),
  git_identity_id UUID REFERENCES git_identities(id),
  context_json JSONB NOT NULL,
  cost_tokens BIGINT DEFAULT 0,
  cost_usd NUMERIC(10,4) DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_runs_task ON agent_runs(task_id, status);

CREATE TABLE tool_calls (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name VARCHAR(50) NOT NULL,
  risk_level VARCHAR(20) NOT NULL,
  params JSONB NOT NULL,
  result JSONB,
  approved_by UUID REFERENCES users(id),
  approval_id UUID REFERENCES approvals(id),
  success BOOLEAN,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES agent_runs(id),
  task_id UUID REFERENCES tasks(id),
  type VARCHAR(50) NOT NULL,          -- diff / log / report / file
  name VARCHAR(500),
  path TEXT,
  size_bytes BIGINT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 6. V5 追加表（部署 / 知识沉淀）

```sql
CREATE TABLE releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  change_ids UUID[] NOT NULL,
  target_env VARCHAR(20) NOT NULL,    -- staging / production
  status VARCHAR(20) NOT NULL,
  approved_by UUID[] DEFAULT '{}',
  deployed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_change_id UUID REFERENCES changes(id),
  path TEXT NOT NULL,
  title VARCHAR(500),
  embedding VECTOR(1536),             -- pgvector
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 7. RLS 启用时机

- V1：不开 RLS（单组织、单 Workspace 常态）
- V3：默认开启，按 `workspace_id` 隔离
- V5：增加 component 级 RLS（component_lead 仅看自己组件）

## 8. Migration 规范

- 工具：Alembic（async）
- 文件名：`YYYYMMDDHHMM_<verb>_<noun>.py`
- 必须能 `downgrade()` 回滚
- 大型变更（删字段、改类型）必须分两步：先加新字段+迁移数据，再删旧字段
- 禁止在 migration 里手写 `op.execute("DROP ...")`，必须用 op.* DSL
- 每次 release 前在测试库跑 `upgrade → downgrade → upgrade` 三次确保幂等

## 9. 备份策略

- V1：每日 pg_dump 到 `/data/backups/postgres/`
- V3：基础物理备份 + WAL 归档（PITR）
- 凭据加密表（`git_identities.encrypted_credential`）：备份必须加密，主密钥不入备份
