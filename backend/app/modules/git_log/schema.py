"""Pydantic schemas for the workspace git_log module.

字段与 design §7.4 逐字段对齐：producer=service 组装（含 lane/edges/refs 合并）
→ FastAPI JSON → consumer=前端 ``pnpm gen:types`` 生成类型。

- ``git_mode`` 只暴露两态 ``git | no_git``（probe 真实三态在 service 映射：
  direct→no_git；unknown→offline 502，不入枚举，design §5.3）；
- ``seq`` 为全局绝对序（skip + 窗口内偏移），追加页 SVG y 坐标与边目标
  均以 seq 为基准（CC-10）；
- ``del`` 是 Python 关键字，Python 侧字段名用 ``del_`` + alias 序列化为
  ``del``（FastAPI response 默认 by_alias=True，JSON 契约不变）；
- status 系三模型（GitLogStatusResponse + dirty/fetch 嵌套）为
  2026-08-26-workspace-git-status 增量：daemon 契约（§7.2）的
  fetch_performed / fetch_error 在 backend 侧拆进 fetch.performed /
  fetch.error 嵌套（§7.3）；synced_at 为 backend 组装时刻（非 daemon 数据）。

设计依据：``.sillyspec/changes/2026-08-25-workspace-git-log/design.md``
§5.3 / §7.4；status 模型另见
``.sillyspec/changes/2026-08-26-workspace-git-status/design.md`` §5.3 / §7.2。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

GitLogMode = Literal["git", "no_git"]
GitLogEdgeKind = Literal["straight", "curve"]
GitLogRefKind = Literal["branch", "remote", "tag", "head"]
GitLogBranchKind = Literal["branch", "remote"]
GitLogFetchErrorCode = Literal["fetch_timeout", "fetch_failed", "no_remote"]


class GitLogEdgeItem(BaseModel):
    """泳道父边（graph_layout 计算；目标在窗口可见范围内才输出，§5.3 lookahead 退化）。"""

    to_seq: int = Field(..., description="父提交的全局绝对序（边绘制目标基准）")
    to_lane: int = Field(..., description="父提交所在泳道编号")
    kind: GitLogEdgeKind = Field(..., description="边类型：straight=同泳道直线 / curve=换泳道曲线")


class GitLogRefItem(BaseModel):
    """提交装饰引用（service 由 git_refs 结果按 sha 合并写入；HEAD 亦入对应提交）。"""

    name: str = Field(..., description="引用短名（refname:short）")
    kind: GitLogRefKind = Field(
        ..., description="引用类型：branch=本地分支 / remote=远程分支 / tag=标签 / head=HEAD"
    )


class GitLogCommitItem(BaseModel):
    """提交列表项（lane/edges 由 backend graph_layout 计算，前端纯渲染，D-004）。"""

    seq: int = Field(..., description="全局绝对序（skip + 窗口内偏移）")
    hash: str = Field(..., description="全长提交哈希")
    short: str = Field(..., description="短哈希")
    parents: list[str] = Field(..., description="父提交全长哈希列表（merge 提交多条）")
    message: str = Field(..., description="提交说明全文（含 body）")
    author_name: str = Field(..., description="作者名")
    author_email: str = Field(..., description="作者邮箱")
    author_date: str = Field(..., description="作者时间（ISO 8601）")
    lane: int = Field(..., description="泳道编号（从 0 起，紧凑分配）")
    edges: list[GitLogEdgeItem] = Field(..., description="父边列表（目标在结果集窗口可见范围内）")
    refs: list[GitLogRefItem] = Field(..., description="提交上的引用装饰（分支/远程/tag/HEAD）")


class GitLogBranchItem(BaseModel):
    """分支下拉项（top-level 全量分支列表，git_refs 结果，与分页窗口无关，CC-07）。"""

    name: str = Field(..., description="分支短名")
    kind: GitLogBranchKind = Field(..., description="branch=本地分支 / remote=远程分支")


class GitLogFileStatItem(BaseModel):
    """变更文件统计项（git_show --numstat --no-renames 输出）。"""

    model_config = ConfigDict(populate_by_name=True)

    path: str = Field(..., description="仓库内相对路径（重命名呈现为删+增两条，§3 非目标）")
    add: int = Field(..., description="新增行数（二进制文件为 0）")
    del_: int = Field(..., alias="del", description="删除行数（二进制文件为 0）")
    binary: bool = Field(..., description="是否二进制文件（numstat 输出「-」时为 true）")


class GitLogCommitsResponse(BaseModel):
    """GET /api/workspaces/{wid}/git-log/commits 响应（提交列表 + 泳道）。"""

    git_mode: GitLogMode = Field(
        ..., description="git=git 仓库（含 worktree 检出）/ no_git=非 git 工作区（前端渲染空态卡）"
    )
    commits: list[GitLogCommitItem] = Field(..., description="提交窗口列表（新→旧序）")
    branches: list[GitLogBranchItem] = Field(..., description="全量分支列表（供工具栏分支下拉）")
    head: str | None = Field(..., description="HEAD 提交全长哈希（空仓库为 null）")
    has_more: bool = Field(..., description="窗口之后是否还有更多提交（分页依据）")
    total_in_window: int = Field(..., description="本次实际返回条数（过滤后可能小于 limit）")


class GitLogCommitDetailResponse(BaseModel):
    """GET /api/workspaces/{wid}/git-log/commits/{sha} 响应（详情 + 变更文件列表）。"""

    hash: str = Field(..., description="全长提交哈希")
    short: str = Field(..., description="短哈希")
    parents: list[str] = Field(..., description="父提交全长哈希列表（merge 提交多条）")
    message: str = Field(..., description="提交说明全文（含 body）")
    author_name: str = Field(..., description="作者名")
    author_email: str = Field(..., description="作者邮箱")
    author_date: str = Field(..., description="作者时间（ISO 8601）")
    committer_date: str = Field(..., description="提交者时间（ISO 8601，详情独有字段）")
    refs: list[GitLogRefItem] = Field(..., description="提交上的引用装饰（分支/远程/tag/HEAD）")
    files: list[GitLogFileStatItem] = Field(
        ..., description="变更文件统计列表（--numstat --no-renames）"
    )


class GitLogDiffResponse(BaseModel):
    """GET /api/workspaces/{wid}/git-log/commits/{sha}/diff 响应（单文件 unified diff）。"""

    diff: str = Field(
        ..., description="unified diff 文本（--unified=3 --no-color；二进制文件为空串）"
    )
    truncated: bool = Field(..., description="是否超 64KB 上限被截断")
    binary: bool = Field(..., description="是否二进制文件（true 时前端直接提示「二进制文件」）")


class GitLogDirtyItem(BaseModel):
    """未提交改动汇总（git diff HEAD --numstat 单源口径，CC-05；空仓库全 null）。"""

    files_changed: int | None = Field(
        ..., description="变更文件数（≡ numstat 行数，staged+unstaged 合并；空仓库为 null）"
    )
    additions: int | None = Field(
        ..., description="新增行数合计（staged+unstaged 合并；空仓库为 null）"
    )
    deletions: int | None = Field(
        ..., description="删除行数合计（staged+unstaged 合并；空仓库为 null）"
    )
    untracked_count: int | None = Field(
        ..., description="未跟踪文件数（porcelain v2「?」条目计数；空仓库为 null）"
    )


class GitLogFetchItem(BaseModel):
    """自动 fetch 结果（D-001：失败降级不阻断其余字段，前端黄条依据）。"""

    performed: bool = Field(
        ..., description="本次是否成功完成 git fetch（false 时 behind 为上次同步的 stale 值）"
    )
    error: GitLogFetchErrorCode | None = Field(
        ...,
        description=(
            "fetch 失败代号：fetch_timeout=超时 / fetch_failed=命令失败 / "
            "no_remote=无远程仓库；成功为 null"
        ),
    )


class GitLogStatusResponse(BaseModel):
    """GET /api/workspaces/{wid}/git-log/status 响应（工作区 Git 健康状态，§5.3）。"""

    git_mode: GitLogMode = Field(
        ..., description="git=git 仓库 / no_git=非 git 工作区（空态，字段全空）"
    )
    branch: str | None = Field(
        ..., description="当前分支名（detached HEAD 时为 HEAD 短哈希；空仓库/非 git 为 null）"
    )
    detached: bool = Field(..., description="是否 detached HEAD（true 时 branch 即短哈希）")
    upstream: str | None = Field(
        ..., description="上游跟踪分支短名（如 origin/main；本地新分支无跟踪为 null）"
    )
    ahead: int | None = Field(..., description="未推送提交数（无 upstream 为 null）")
    behind: int | None = Field(
        ..., description="远程新提交数（fetch 失败时为上次同步的 stale 值，配 fetch.error 提示）"
    )
    dirty: GitLogDirtyItem = Field(..., description="未提交改动汇总（staged+unstaged 合并口径）")
    head_short: str | None = Field(
        ..., description="HEAD 短哈希（branch.oid 前 8 位；空仓库/非 git 为 null）"
    )
    empty: bool = Field(..., description="是否空仓库（无任何提交，前端空态提示）")
    fetch: GitLogFetchItem = Field(
        ..., description="自动 fetch 结果（performed=false + error 代号 → 前端黄条降级提示）"
    )
    synced_at: str = Field(
        ...,
        description="状态组装时刻（ISO 8601 UTC，backend 生成；前端显示「已同步 · HH:MM」）",
    )
