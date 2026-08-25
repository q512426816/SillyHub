"""Pydantic schemas for the workspace git_log module.

字段与 design §7.4 逐字段对齐：producer=service 组装（含 lane/edges/refs 合并）
→ FastAPI JSON → consumer=前端 ``pnpm gen:types`` 生成类型。

- ``git_mode`` 只暴露两态 ``git | no_git``（probe 真实三态在 service 映射：
  direct→no_git；unknown→offline 502，不入枚举，design §5.3）；
- ``seq`` 为全局绝对序（skip + 窗口内偏移），追加页 SVG y 坐标与边目标
  均以 seq 为基准（CC-10）；
- ``del`` 是 Python 关键字，Python 侧字段名用 ``del_`` + alias 序列化为
  ``del``（FastAPI response 默认 by_alias=True，JSON 契约不变）。

设计依据：``.sillyspec/changes/2026-08-25-workspace-git-log/design.md``
§5.3 / §7.4。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

GitLogMode = Literal["git", "no_git"]
GitLogEdgeKind = Literal["straight", "curve"]
GitLogRefKind = Literal["branch", "remote", "tag", "head"]
GitLogBranchKind = Literal["branch", "remote"]


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
