"""变更上下文前导构建（2026-07-09-change-detail-session / D-004@v1 / FR-03）。

为变更会话首轮注入【变更上下文】前导（标题 / 阶段 / 工作目录 / 文档路径 /
已变更文件），经 dispatch prompt 通道注入（X-02 纯后端，零 daemon 改动）。

前导样例::

    【变更上下文】
    - 标题：变更详情页内嵌会话
    - 当前阶段：execute
    - 工作目录：/home/user/projects/foo
    - design: changes/2026-07-09-change-detail-session/design.md
    - plan: changes/2026-07-09-change-detail-session/plan.md
    - 已变更文件：
      - design.md
      - plan.md

Author: SillySpec change 2026-07-09-change-detail-session (Wave 2 task-07)
Created: 2026-07-09
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.change.model import Change, ChangeDocument
from app.modules.change.service import ChangeService
from app.modules.workspace.model import Workspace

# 前导里展示的文档类型（与变更四件套一致，固定顺序）。
_PREAMBLE_DOC_TYPES: tuple[str, ...] = (
    "proposal",
    "requirements",
    "design",
    "plan",
    "tasks",
)

# 已变更文件清单最多展示条数，超出截断并提示总数。
_MAX_FILE_LISTING: int = 30


async def build_change_context_preamble(
    db: AsyncSession, change_id: uuid.UUID | None
) -> str | None:
    """拼装【变更上下文】前导字符串。

    - ``change_id`` 为 None 或查无变更时返回 None（调用方据此决定是否注入）。
    - 复用 ``ChangeService.list_files`` 取已变更文件清单（X-01），不重复实现文件枚举。
    - 文档路径按固定 ``_PREAMBLE_DOC_TYPES`` 顺序、仅取 exists 的文档。
    - 无任何可用信息时返回 None。
    """
    if change_id is None:
        return None

    change = await db.get(Change, change_id)
    if change is None:
        return None

    # 工作目录（workspace 本地根）。
    workspace = await db.get(Workspace, change.workspace_id)
    workdir = workspace.root_path if workspace else None

    # 文档路径（按固定类型顺序，只取 exists 的）。查询惯例对齐
    # change/service.py:1117（select ChangeDocument where change_id）。
    doc_rows = (
        (await db.execute(select(ChangeDocument).where(col(ChangeDocument.change_id) == change_id)))
        .scalars()
        .all()
    )
    docs_by_type: dict[str, str] = {
        row.doc_type: row.path
        for row in doc_rows
        if row.exists and row.doc_type in _PREAMBLE_DOC_TYPES and row.path
    }

    # 已变更文件清单（复用 list_files，X-01）。变更目录不存在或读盘失败返回空。
    try:
        files = await ChangeService(db).list_files(change.workspace_id, change_id)
    except Exception:
        files = []
    file_paths: list[str] = [f["path"] for f in files if isinstance(f, dict) and f.get("path")]

    # 拼前导（多行纯文本）。
    lines: list[str] = ["【变更上下文】"]
    if change.title:
        lines.append(f"- 标题：{change.title}")
    if change.current_stage:
        lines.append(f"- 当前阶段：{change.current_stage}")
    if workdir:
        lines.append(f"- 工作目录：{workdir}")

    # 文档路径块（按固定顺序，每个 doc_type 一行）。
    for doc_type in _PREAMBLE_DOC_TYPES:
        doc_path = docs_by_type.get(doc_type)
        if doc_path:
            lines.append(f"- {doc_type}: {doc_path}")

    # 已变更文件清单块（控制长度，过多截断）。
    if file_paths:
        lines.append("- 已变更文件：")
        for rel_path in file_paths[:_MAX_FILE_LISTING]:
            lines.append(f"  - {rel_path}")
        if len(file_paths) > _MAX_FILE_LISTING:
            lines.append(f"  ...共 {len(file_paths)} 个文件")

    if len(lines) <= 1:
        return None  # 无任何可用信息
    return "\n".join(lines)


# ── 页面上下文前导（2026-08-25-unified-floating-session / FR-5 / D-005）──────
#
# 悬浮会话入口的「智能上下文」创建轮通道：客户端仅声明 page_key 枚举 + 实体
# id，前导数据全部服务端回查（无自由文本，防伪造注入）。拼装模式与
# build_change_context_preamble 同构（X-02 纯后端，零 daemon 改动）。

# 前导单值截断上限（project_name 等业务字段可能超长，控制前导总长度）。
_PAGE_VALUE_MAX: int = 120


async def build_page_context_preamble(
    db: AsyncSession,
    page_key: str | None,
    project_id: uuid.UUID | None,
) -> str | None:
    """拼装【页面上下文】前导字符串。

    - ``page_key`` 非 "ppm_project" 或 ``project_id`` 为 None → None（不注入）。
    - 回查 :class:`PpmProjectMaintenance`；查无 → None（静默不注入，与变更
      前导「查无返回 None」语义一致）。
    - 单值 ``[:120]`` 截断；数据只来自服务端 DB，不接受客户端文本。
    """
    if page_key != "ppm_project" or project_id is None:
        return None

    from app.modules.ppm.project.model import PpmProjectMaintenance

    project = await db.get(PpmProjectMaintenance, project_id)
    if project is None:
        return None

    lines: list[str] = ["【页面上下文】", "- 页面：PPM · 项目详情"]
    if project.project_name:
        lines.append(f"- 项目：{project.project_name[:_PAGE_VALUE_MAX]}")
    if project.project_code:
        lines.append(f"- 项目编码：{project.project_code[:_PAGE_VALUE_MAX]}")
    if project.project_status:
        lines.append(f"- 状态：{project.project_status[:_PAGE_VALUE_MAX]}")
    if project.project_effective_start_time:
        lines.append(f"- 周期起：{project.project_effective_start_time.date().isoformat()}")
    if project.project_effective_end_time:
        lines.append(f"- 周期止：{project.project_effective_end_time.date().isoformat()}")

    if len(lines) <= 1:
        return None
    return "\n".join(lines)
