# 08 — API Contract 草案

## Workspace

```http
GET /api/workspaces
POST /api/workspaces/scan
GET /api/workspaces/{workspace_id}
```

## Components

```http
GET /api/workspaces/{workspace_id}/components
GET /api/workspaces/{workspace_id}/components/{component_id}
GET /api/workspaces/{workspace_id}/components/{component_id}/scan-docs
```

## Changes

```http
GET /api/workspaces/{workspace_id}/changes
GET /api/workspaces/{workspace_id}/changes/{change_id}
POST /api/workspaces/{workspace_id}/changes
```

## Tasks

```http
GET /api/workspaces/{workspace_id}/changes/{change_id}/tasks
GET /api/workspaces/{workspace_id}/tasks/{task_id}
```

## Runtime

```http
GET /api/workspaces/{workspace_id}/runtime
```

## Git Identity

```http
GET /api/git/identities
POST /api/git/identities
DELETE /api/git/identities/{identity_id}
POST /api/git/check-access
```

## Worktree

```http
POST /api/worktrees/acquire
POST /api/worktrees/{lease_id}/release
GET /api/worktrees/{lease_id}
```

## Agent

```http
POST /api/agent-runs
GET /api/agent-runs/{run_id}
POST /api/agent-runs/{run_id}/cancel
```
