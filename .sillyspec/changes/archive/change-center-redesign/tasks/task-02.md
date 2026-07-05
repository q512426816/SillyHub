---
id: task-02
title: "后端 service 增强 — create_change 写 proposal.md + 设 current_stage=created"
wave: W1
priority: P0
estimate: 1h
depends_on: []
status: pending
assignee: ""
created_at: 2026-05-31T14:20:00+08:00
---

# Task-02: 后端 service 增强 — create_change 写 proposal.md + 设 current_stage=created

## 目标

增强 `ChangeWriterService.create_change()` 方法，使其在创建变更时：
1. 接收 `description` 参数
2. 写入 `proposal.md` 文件（包含用户描述）
3. 设置 `current_stage='created'`
4. 设置 `stages={'created': {'status': 'done', 'at': now}}`
5. 设置 `status='active'`（而非当前的 `'draft'`）

## 目标文件

| 文件 | 操作 |
|------|------|
| `backend/app/modules/change_writer/service.py` | 修改 |

## 当前代码分析

### `service.py` — `create_change()` 方法（第 43–122 行）

当前签名：
```python
async def create_change(
    self,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    title: str,
    change_type: str | None = None,
    affected_components: list[str] | None = None,
    lease_id: uuid.UUID | None = None,
) -> Change:
```

当前行为：
- 计算 `change_key`，创建 `change_dir` 目录
- 写 `MASTER.md`
- 创建 DB 记录：`status="draft"`, `current_stage` 默认为 `None`, `stages` 默认为 `{}`
- 添加 MASTER.md 的 ChangeDocument 记录

### `Change` model — 已有字段（`model.py`）

- `status: str` — 默认 `"draft"`，String(30)
- `current_stage: str | None` — 默认 `None`，String，nullable
- `stages: dict` — 默认 `{}`，JSON，nullable

**无需 migration，字段已存在。**

## 详细改动

### 步骤 1：修改 `create_change()` 签名 — 新增 `description` 参数

在 `lease_id` 参数后追加：

```python
async def create_change(
    self,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    title: str,
    change_type: str | None = None,
    affected_components: list[str] | None = None,
    lease_id: uuid.UUID | None = None,
    description: str = "",                    # ← 新增，有默认值保持兼容
) -> Change:
```

### 步骤 2：在写 MASTER.md 之后、创建 DB 记录之前，写入 proposal.md

在 `(change_dir / "MASTER.md").write_text(...)` 之后插入：

```python
        # Write proposal.md with user description
        if description:
            proposal_content = (
                f"# {title}\n\n"
                f"## 需求描述\n\n"
                f"{description}\n"
            )
            (change_dir / "proposal.md").write_text(proposal_content, encoding="utf-8")
```

### 步骤 3：修改 DB 记录创建 — 设置 status / current_stage / stages

将现有的 `Change(...)` 构造改为：

```python
        now = datetime.utcnow()

        # Create DB record
        change = Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=change_key,
            title=title,
            status="active",                              # ← 改为 "active"
            location="active",
            path=str(change_dir.relative_to(repo_dir)),
            affected_components=affected_components or [],
            change_type=change_type,
            owner_id=user_id,
            current_stage="created",                      # ← 新增
            stages={"created": {"status": "done", "at": now.isoformat()}},  # ← 新增
        )
```

> 注意：`stages.created.at` 使用 ISO 格式字符串存储（JSON 兼容）。

### 步骤 4：为 proposal.md 添加 ChangeDocument 记录

在 MASTER.md 的 ChangeDocument 记录之后、`commit` 之前插入：

```python
        # Add proposal.md as a document (if description was provided)
        if description:
            proposal_doc = ChangeDocument(
                id=uuid.uuid4(),
                change_id=change.id,
                doc_type="proposal",
                path=str(change_dir.relative_to(repo_dir) / "proposal.md"),
                exists=True,
                last_modified_at=datetime.utcnow(),
            )
            self._session.add(proposal_doc)
```

### 步骤 5：用 `now` 替换 MASTER.md doc 记录中的重复 `datetime.utcnow()` 调用

统一使用前面定义的 `now` 变量，避免多次调用产生微小差异：

```python
        doc = ChangeDocument(
            id=uuid.uuid4(),
            change_id=change.id,
            doc_type="master",
            path=str(change_dir.relative_to(repo_dir) / "MASTER.md"),
            exists=True,
            last_modified_at=now,     # ← 复用 now
        )
```

## 完整改动后的 create_change() 方法（参考）

```python
    async def create_change(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        title: str,
        change_type: str | None = None,
        affected_components: list[str] | None = None,
        lease_id: uuid.UUID | None = None,
        description: str = "",
    ) -> Change:
        """Create a change directory + MASTER.md + proposal.md inside the lease worktree or workspace root."""
        if lease_id is not None:
            lease = await self._get_active_lease(lease_id, user_id)
            if lease.workspace_id != workspace_id:
                raise ChangeWriteError(
                    "Lease does not belong to this workspace.",
                    details={"lease_id": str(lease_id), "workspace_id": str(workspace_id)},
                )
            repo_dir = ExecEnvBuilder().repo_dir(Path(lease.path))
        else:
            workspace = await self._session.get(Workspace, workspace_id)
            if workspace is None or workspace.deleted_at is not None:
                raise WorkspaceNotFound(
                    "Workspace not found.",
                    details={"workspace_id": str(workspace_id)},
                )
            repo_dir = Path(_rewrite_path(workspace.root_path))

        # Compute change_key from date + slugified title
        date_prefix = datetime.utcnow().strftime("%Y-%m-%d")
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "untitled"
        change_key = f"{date_prefix}-{slug}"
        change_dir = repo_dir / ".sillyspec" / "changes" / "change" / change_key
        change_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.utcnow()

        # Write MASTER.md
        master_content = build_master_md(
            title=title,
            change_type=change_type,
            affected_components=affected_components,
        )
        (change_dir / "MASTER.md").write_text(master_content, encoding="utf-8")

        # Write proposal.md with user description
        if description:
            proposal_content = f"# {title}\n\n## 需求描述\n\n{description}\n"
            (change_dir / "proposal.md").write_text(proposal_content, encoding="utf-8")

        # Create DB record
        change = Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=change_key,
            title=title,
            status="active",
            location="active",
            path=str(change_dir.relative_to(repo_dir)),
            affected_components=affected_components or [],
            change_type=change_type,
            owner_id=user_id,
            current_stage="created",
            stages={"created": {"status": "done", "at": now.isoformat()}},
        )
        self._session.add(change)

        # Add MASTER.md as a document
        doc = ChangeDocument(
            id=uuid.uuid4(),
            change_id=change.id,
            doc_type="master",
            path=str(change_dir.relative_to(repo_dir) / "MASTER.md"),
            exists=True,
            last_modified_at=now,
        )
        self._session.add(doc)

        # Add proposal.md as a document (if description was provided)
        if description:
            proposal_doc = ChangeDocument(
                id=uuid.uuid4(),
                change_id=change.id,
                doc_type="proposal",
                path=str(change_dir.relative_to(repo_dir) / "proposal.md"),
                exists=True,
                last_modified_at=now,
            )
            self._session.add(proposal_doc)

        await self._session.commit()
        await self._session.refresh(change)

        log.info(
            "change_created",
            change_id=str(change.id),
            change_key=change_key,
            lease_id=str(lease_id),
            current_stage="created",
        )
        return change
```

## 兼容性说明

- `description` 参数默认值 `""`，现有调用方无需改动
- `status` 从 `"draft"` → `"active"`：这是行为变更，但 `plan.md` 中明确要求 `status='active'`
- `current_stage` 和 `stages` 字段已在 DB model 中存在，无需 migration
- `proposal.md` 仅在 `description` 非空时写入和记录

## 验收标准

- [ ] `create_change()` 接受 `description` 参数（默认 `""`）
- [ ] 当 `description` 非空时，写入 `proposal.md` 文件到 change 目录
- [ ] `proposal.md` 包含标题和用户描述内容
- [ ] DB 记录 `status='active'`（非 `"draft"`）
- [ ] DB 记录 `current_stage='created'`
- [ ] DB 记录 `stages={'created': {'status': 'done', 'at': <ISO timestamp>}}`
- [ ] `proposal.md` 对应的 `ChangeDocument` 记录写入 `change_documents` 表
- [ ] 无 `description` 时调用（向后兼容）不写 `proposal.md`，行为正常
- [ ] 现有单元测试通过（`description=""` 时行为与旧版一致）
- [ ] 新增单元测试覆盖：有 description → 写文件 + 设 stages + 设 status
