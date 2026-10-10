"""关联仓表级逻辑（task-02，FR-01/FR-02）。

router 只做权限/参数绑定，本模块负责 CRUD/重名/级联/成员路径 upsert。
权限口径（design 接口定义）：共享字段写=WORKSPACE_MEMBER_MANAGE（router 层），
my-path=成员本人（端点只作用于 current user 的行，无 user_id 参数——不存在
读写他人路径的入口）。
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.workspace.linked_repos.model import (
    WorkspaceLinkedRepo,
    WorkspaceLinkedRepoPath,
)
from app.modules.workspace.linked_repos.schema import LinkedRepoOut


class LinkedRepoNotFound(Exception):
    """关联仓不存在（router 层转 404）。"""


class LinkedRepoNameConflict(Exception):
    """同工作区重名（router 层转 409）。"""


async def list_repos(
    session: AsyncSession,
    workspace_id: UUID,
    viewer_user_id: UUID,
    viewer_is_elevated: bool = False,
) -> list[LinkedRepoOut]:
    """列出工作区关联仓（含 viewer 的 my_path 与落盘状态摘要）。

    summary 聚合口径（design 接口定义）：普通成员=自己绑定机器的最新逐层
    状态；owner（workspace 建者）/platform admin=全部机器（提权视角由
    router 层判定传入，验收审查问题 D 修复）。
    """
    repos = (
        (
            await session.execute(
                select(WorkspaceLinkedRepo)
                .where(WorkspaceLinkedRepo.workspace_id == workspace_id)
                .order_by(WorkspaceLinkedRepo.created_at, WorkspaceLinkedRepo.name)
            )
        )
        .scalars()
        .all()
    )
    if not repos:
        return []
    repo_ids = [r.id for r in repos]
    paths = (
        (
            await session.execute(
                select(WorkspaceLinkedRepoPath).where(
                    WorkspaceLinkedRepoPath.linked_repo_id.in_(repo_ids),
                    WorkspaceLinkedRepoPath.user_id == viewer_user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    my_path_by_repo = {p.linked_repo_id: p.root_path for p in paths}
    # task-03：summary 填充（懒导入防环——daemon 模块 import 本模块）。
    from app.modules.daemon.linked_repos_sync import summary_for_repos

    summary = await summary_for_repos(
        session, workspace_id, repo_ids, viewer_user_id, viewer_is_elevated
    )
    return [
        LinkedRepoOut(
            id=r.id,
            name=r.name,
            repo_url=r.repo_url,
            description=r.description,
            rel_path=r.rel_path,
            my_path=my_path_by_repo.get(r.id),
            sync_status_summary=summary.get(r.id, []),
        )
        for r in repos
    ]


async def create_repo(
    session: AsyncSession,
    workspace_id: UUID,
    *,
    name: str,
    repo_url: str | None,
    description: str | None,
    rel_path: str | None,
    created_by: UUID | None,
) -> WorkspaceLinkedRepo:
    exists = await session.execute(
        select(WorkspaceLinkedRepo.id).where(
            WorkspaceLinkedRepo.workspace_id == workspace_id,
            WorkspaceLinkedRepo.name == name,
        )
    )
    if exists.first() is not None:
        raise LinkedRepoNameConflict(name)
    row = WorkspaceLinkedRepo(
        workspace_id=workspace_id,
        name=name,
        repo_url=repo_url,
        description=description,
        rel_path=rel_path,
        created_by=created_by,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_repo(
    session: AsyncSession, repo_id: UUID, workspace_id: UUID | None = None
) -> WorkspaceLinkedRepo:
    """按 id 取行；workspace_id 给出时校验归属（跨工作区越权统一 404，
    execute 验收审查问题 A 修复）。"""
    row = await session.get(WorkspaceLinkedRepo, repo_id)
    if row is None or (workspace_id is not None and row.workspace_id != workspace_id):
        raise LinkedRepoNotFound(str(repo_id))
    return row


async def update_repo(
    session: AsyncSession,
    repo_id: UUID,
    workspace_id: UUID,
    *,
    fields: dict[str, str | None],
) -> WorkspaceLinkedRepo:
    """编辑共享字段（owner/admin）。

    fields 为显式提交键集合（router 层 model_dump(exclude_unset=True) 组装）：
    键在场即更新（值可为 None=显式清除——JSON null 与缺省可区分，验收审查
    问题 B 修复）；不在场即不动。
    """
    row = await get_repo(session, repo_id, workspace_id)
    for key in ("repo_url", "description", "rel_path"):
        if key in fields:
            setattr(row, key, fields[key])
    await session.commit()
    await session.refresh(row)
    return row


async def delete_repo(session: AsyncSession, repo_id: UUID, workspace_id: UUID) -> None:
    """删共享登记行；paths/sync_states 由 DB 级 ondelete=CASCADE 清理（迁移已建）。"""
    row = await get_repo(session, repo_id, workspace_id)
    await session.delete(row)
    await session.commit()


async def upsert_my_path(
    session: AsyncSession, repo_id: UUID, workspace_id: UUID, user_id: UUID, path: str | None
) -> None:
    """成员级本机路径 upsert；path=None 清除该成员行（repo 归属工作区校验）。"""
    await get_repo(session, repo_id, workspace_id)  # 404/越权语义
    stmt = select(WorkspaceLinkedRepoPath).where(
        WorkspaceLinkedRepoPath.linked_repo_id == repo_id,
        WorkspaceLinkedRepoPath.user_id == user_id,
    )
    existing = (await session.execute(stmt)).scalars().first()
    if path is None or path == "":
        if existing is not None:
            await session.delete(existing)
            await session.commit()
        return
    if existing is not None:
        existing.root_path = path
    else:
        session.add(
            WorkspaceLinkedRepoPath(linked_repo_id=repo_id, user_id=user_id, root_path=path)
        )
    await session.commit()


async def import_repos(
    session: AsyncSession,
    workspace_id: UUID,
    actor_user_id: UUID,
    entries: list,
) -> list:
    """从本机快照条目导入（FR-03，Grill Gap A：合并条目一次落 rel_path 与 my_path）。

    逐条独立成败：重名 skipped（不重不丢）；failed 带 detail 不回滚已成功条目。
    """
    out = []
    import re as _re

    for item in entries:
        name = item.name
        if not _re.match(r"^[A-Za-z0-9_.\-]+$", name):
            out.append({"name": name, "result": "failed", "detail": "仓库名非法"})
            continue
        try:
            await create_repo(
                session,
                workspace_id,
                name=name,
                repo_url=None,
                description=None,
                rel_path=item.rel_path,
                created_by=actor_user_id,
            )
            result = "imported"
            detail = None
        except LinkedRepoNameConflict:
            result = "skipped"
            detail = None
        except Exception as exc:  # 单条失败不回滚已成功条目
            result = "failed"
            detail = str(exc)[:200]
        # 重名/新建后写 my_path（abs_path 在场时）——按 name 反查行
        if item.abs_path and result in ("imported", "skipped"):
            try:
                stmt = select(WorkspaceLinkedRepo).where(
                    WorkspaceLinkedRepo.workspace_id == workspace_id,
                    WorkspaceLinkedRepo.name == name,
                )
                row = (await session.execute(stmt)).scalars().first()
                if row is not None:
                    await upsert_my_path(
                        session, row.id, workspace_id, actor_user_id, item.abs_path
                    )
            except Exception as exc:
                result = "failed"
                detail = f"my_path 写入失败: {exc}"[:200]
        out.append({"name": name, "result": result, "detail": detail})
    return out
