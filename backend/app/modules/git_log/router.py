"""HTTP routes for the git_log module — 工作区 Git 日志（类 IDEA Git Log）三端点。

「浏览器 → backend → daemon → 宿主机 git」只读查询链路的 HTTP 层（design §7.1）：

- 三 GET 端点统一 ``require_permission(Permission.WORKSPACE_READ)`` 门控，
  依赖形态沿用 explorer/router.py 先例（``Annotated[User, Depends(...)]``）；
- router 层做参数静态校验（skip/limit 窗口、sha/branch/author/path 白名单），
  helper 为 service 层模块内共享函数，非法统一 ``GitLogInvalidParam`` 422；
- 显式超时与全量错误映射（AppError 子类中文文案）在 service 层收口，
  router 直接透传、不二次映射（explorer/router.py 同款）。

设计依据：``.sillyspec/changes/2026-08-25-workspace-git-log/design.md``
（§7.1 端点表 / §5.3 模块形态）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.git_log.schema import (
    GitLogCommitDetailResponse,
    GitLogCommitsResponse,
    GitLogDiffResponse,
)
from app.modules.git_log.service import (
    GitLogService,
    _validate_author,
    _validate_branch,
    _validate_diff_path,
    _validate_pagination,
    _validate_sha,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/git-log",
    tags=["git-log"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/commits", response_model=GitLogCommitsResponse)
async def list_git_log_commits(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    skip: int = Query(default=0, description="跳过条数（全局绝对序起点，上限 2000）"),
    limit: int = Query(default=100, description="窗口大小（1 到 200）"),
    branch: str = Query(default="", description="分支过滤（空 = 全部分支 --all）"),
    author: str = Query(default="", description="作者过滤（git --author 匹配语义）"),
) -> GitLogCommitsResponse:
    """提交列表 + 泳道 lane/edges（design §7.1 端点 ①，RPC 超时 30s）。"""
    _validate_pagination(skip, limit)
    _validate_branch(branch)
    _validate_author(author)
    service = GitLogService(session)
    return await service.list_commits(
        workspace_id, user.id, skip=skip, limit=limit, branch=branch, author=author
    )


@router.get("/commits/{sha}", response_model=GitLogCommitDetailResponse)
async def get_git_log_commit(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    sha: str,
) -> GitLogCommitDetailResponse:
    """提交详情 + 变更文件列表（design §7.1 端点 ②，RPC 超时 30s）。"""
    _validate_sha(sha)
    service = GitLogService(session)
    return await service.get_commit_detail(workspace_id, user.id, sha)


@router.get("/commits/{sha}/diff", response_model=GitLogDiffResponse)
async def get_git_log_diff(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    sha: str,
    path: str = Query(min_length=1, description="仓库内文件相对路径（必填）"),
) -> GitLogDiffResponse:
    """单文件 unified diff（design §7.1 端点 ③，RPC 超时 30s，超 64KB 截断）。"""
    _validate_sha(sha)
    _validate_diff_path(path)
    service = GitLogService(session)
    return await service.get_file_diff(workspace_id, user.id, sha, path)
