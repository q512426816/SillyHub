# 03 — 领域模型

## 核心模型

```text
Workspace
ProjectComponent
ComponentRelation
ScanDocument
Change
ChangeDocument
Task
RuntimeState
KnowledgeDocument
QuickLog
GitIdentity
WorktreeLease
AgentRun
ToolCall
AuditEvent
Approval
Artifact
```

## 关系

```text
Workspace
  ├─ ProjectComponent[]
  ├─ Change[]
  ├─ KnowledgeDocument[]
  ├─ QuickLog[]
  └─ RuntimeState

Change
  ├─ affected_components[]
  ├─ ChangeDocument[]
  └─ Task[]

Task
  ├─ affected_components[]
  ├─ AgentRun[]
  ├─ WorktreeLease[]
  └─ Artifact[]
```

## 关键修正

错误模型：

```text
Project → Change → Task
```

正确模型：

```text
Workspace
  ├─ ProjectComponent[]
  └─ Change[]
       └─ affected_components[]
```
