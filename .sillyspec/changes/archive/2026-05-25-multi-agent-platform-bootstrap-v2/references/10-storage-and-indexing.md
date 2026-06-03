# 10 — 存储与索引设计

## 1. 文件事实源

SillySpec 文件仍然是事实源。

平台数据库只存：

- 索引。
- 状态缓存。
- 权限。
- 审计。
- Git Identity。
- Worktree Lease。

## 2. 索引对象

```text
WorkspaceIndex
ComponentIndex
ScanDocIndex
ChangeIndex
TaskIndex
KnowledgeIndex
RuntimeSnapshot
```

## 3. 同步策略

V1：手动扫描。

V2：文件变更后重新索引。

V3：Git hook / watcher 触发增量索引。

## 4. 数据库

V1 可用 SQLite。

V3+ 推荐 PostgreSQL。

## 5. 文件存储

V1 使用本地文件系统。

V4+ 可接入 S3 / MinIO。
