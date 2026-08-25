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

# 通用页面注册表（task-09：route_key → 页面中文名）。前端 hooks/
# use-page-session-context.ts 持有同键的路由→key 映射；两侧键必须一致，
# 标签文案各自维护（前端用于上下文条展示，后端用于前导注入）。未注册键
# 静默不注入（枚举语义，防伪造注入：客户端无法注入任意文本）。
PAGE_ROUTE_LABELS: dict[str, str] = {
    "settings_mcp": "设置 · MCP",
    "settings_skills": "设置 · Skills",
    "settings": "设置",
    "runtimes": "运行时",
    "workspaces": "工作区列表",
    "workspace_detail": "工作区详情",
    "agent_profiles": "智能体档案",
    "sessions_portal": "会话门户",
    "ppm_projects": "PPM · 项目列表",
    "ppm_workbench": "PPM · 工作台",
    "admin": "管理后台",
    "account": "个人中心",
}

# 页面说明书知识库（task-13，用户反馈"要能识别页面是干什么的、指导怎么用，
# 可生成固定文档作为知识库"）：route_key → 固定文档（功能 + 使用指南）。
# 服务端维护的静态知识（与代码同仓演进），随【页面上下文】前导注入——AI
# 即获得"这是什么页面 / 用户在做什么 / 怎么指导使用"的完整背景。长度纪律：
# 每页 ≤ 6 行（前导总长可控）；后续可迁 DB/知识模块按需富化。
PAGE_MANUALS: dict[str, str] = {
    "settings_mcp": (
        "- 功能：管理 MCP（Model Context Protocol）服务器与令牌。MCP 服务器为智能体"
        "提供外部工具（检索、数据库、第三方 API 等）；MCP 令牌供外部服务安全回调本平台。\n"
        "- 使用：列表页添加/编辑 MCP 服务器（名称、传输方式、命令或 URL）并可测试连接；"
        "「MCP 令牌」页创建令牌分发给外部服务；在智能体档案或工作区配置里引用后，"
        "智能体会话中即可调用这些工具。"
    ),
    "settings_skills": (
        "- 功能：管理自定义技能（Skills）——可复用的提示词/流程包，挂载给智能体档案后"
        "在会话中按名调用。\n"
        "- 使用：列表页新建或编辑技能内容；在智能体档案的 Skills 配置中勾选引用。"
    ),
    "settings": (
        "- 功能：平台设置中心，含 MCP、Skills 等子页。\n- 使用：从左侧子导航进入对应设置页。"
    ),
    "runtimes": (
        "- 功能：查看/管理在线机器与运行时引擎（Claude Code、Codex 等）。机器安装"
        "平台 daemon 后自动注册并心跳在线；会话会派发到所选机器上执行。\n"
        "- 使用：列表查看机器在线状态与各引擎运行时；可禁用/启用运行时、触发自更新；"
        "机器卡上可发起会话（钉定该机器）。"
    ),
    "workspaces": (
        "- 功能：工作区列表——每个工作区对应一个项目代码库，是变更、会话、文件、"
        "知识库、智能体配置的容器。\n"
        "- 使用：卡片进入工作区详情；可新建工作区（填根路径后扫描识别技术栈）；"
        "右下角悬浮会话助手可随时唤起提问。"
    ),
    "workspace_detail": (
        "- 功能：单个工作区的开发中枢。顶部导航：概览 / 变更 / 会话 / 文件 / 知识库 /"
        " 组件 / 扫描文档 / 运行时 / 智能体档案 / Skills / MCP / 成员等。\n"
        "- 使用：变更页走规范驱动开发（提案→设计→计划→执行→验证）；会话页与 AI 对话"
        "或派团队任务；文件页浏览仓库；概览页「扫描」生成/刷新项目档案。"
    ),
    "agent_profiles": (
        "- 功能：智能体档案——定义智能体的系统提示词、模型供应商、MCP 服务器与 "
        "Skills 挂载。\n"
        "- 使用：新建档案并配置各维度；创建会话时选择档案，会话即按其配置运行，"
        "可中途切换。"
    ),
    "sessions_portal": (
        "- 功能：会话门户——全站会话的完整管理视图（左侧工作区分组列表 + 右侧对话）。\n"
        "- 使用：左侧选会话继续对话，组头「＋」选机器与智能体新建；顶部配置条可"
        "切换机器/智能体/供应商/档案；支持批量删除与归档。"
    ),
    "ppm_projects": (
        "- 功能：PPM 项目列表——项目全生命周期维护（名称、编码、状态、周期、成员）。\n"
        "- 使用：行内「成员管理」维护项目成员；「关联工作区」绑定代码库；"
        "「发起团队」直接带着本项目上下文唤起 AI 智能体团队会话。"
    ),
    "ppm_workbench": (
        "- 功能：PPM 工作台——跨项目的个人待办与进行中任务概览。\n"
        "- 使用：查看待办与智能体任务进度，点击跳转对应项目详情。"
    ),
    "admin": (
        "- 功能：管理后台——组织架构、用户、角色与权限管理。\n"
        "- 使用：组织树维护部门层级；用户管理增删账号与分配角色；角色页配置"
        "菜单与操作权限。"
    ),
    "account": (
        "- 功能：个人中心——账号信息与个人偏好。\n- 使用：查看/修改个人信息与会话助手等偏好设置。"
    ),
}


async def build_page_context_preamble(
    db: AsyncSession,
    page_key: str | None,
    project_id: uuid.UUID | None,
    route_key: str | None = None,
    workspace_id: uuid.UUID | None = None,
) -> str | None:
    """拼装【页面上下文】前导字符串。

    - ``ppm_project``：回查 :class:`PpmProjectMaintenance`；查无 → None
      （静默不注入，与变更前导「查无返回 None」语义一致）；单值 ``[:120]``
      截断；数据只来自服务端 DB，不接受客户端文本。
    - ``generic_page``（task-09）：``PAGE_ROUTE_LABELS`` 注册表 Lookup 出
      页面中文名；未注册 key → None（枚举语义）。task-13 起附 ``PAGE_MANUALS``
      页面说明书（功能+使用），AI 可回答"这是什么页面/怎么用"。
    - ``workspace``（task-10）：回查 :class:`Workspace` 注入名称/类型/路径；
      查无 → None。task-13 起附工作区页面说明书。
    - 其余 / 入参缺失 → None（不注入）。
    """
    if page_key == "workspace":
        if workspace_id is None:
            return None
        ws = await db.get(Workspace, workspace_id)
        if ws is None:
            return None
        lines = ["【页面上下文】", "- 页面：工作区详情"]
        if ws.name:
            lines.append(f"- 工作区：{ws.name[:_PAGE_VALUE_MAX]}")
        if ws.type:
            lines.append(f"- 类型：{ws.type[:_PAGE_VALUE_MAX]}")
        if ws.root_path:
            lines.append(f"- 路径：{ws.root_path[:_PAGE_VALUE_MAX]}")
        manual = PAGE_MANUALS.get("workspace_detail")
        if manual:
            lines.append(manual)
        if len(lines) <= 1:
            return None
        return "\n".join(lines)
    if page_key == "generic_page":
        key = route_key or ""
        label = PAGE_ROUTE_LABELS.get(key)
        if label is None:
            return None
        manual = PAGE_MANUALS.get(key)
        parts = [f"【页面上下文】\n- 页面：{label}"]
        if manual:
            parts.append(manual)
        return "\n".join(parts)

    if page_key != "ppm_project" or project_id is None:
        return None

    from app.modules.ppm.project.model import PpmProjectMaintenance

    project = await db.get(PpmProjectMaintenance, project_id)
    if project is None:
        return None

    proj_lines: list[str] = ["【页面上下文】", "- 页面：PPM · 项目详情"]
    if project.project_name:
        proj_lines.append(f"- 项目：{project.project_name[:_PAGE_VALUE_MAX]}")
    if project.project_code:
        proj_lines.append(f"- 项目编码：{project.project_code[:_PAGE_VALUE_MAX]}")
    if project.project_status:
        proj_lines.append(f"- 状态：{project.project_status[:_PAGE_VALUE_MAX]}")
    if project.project_effective_start_time:
        proj_lines.append(f"- 周期起：{project.project_effective_start_time.date().isoformat()}")
    if project.project_effective_end_time:
        proj_lines.append(f"- 周期止：{project.project_effective_end_time.date().isoformat()}")
    proj_lines.append(
        "- 功能：PPM 项目详情——里程碑、问题单、任务计划、干系人与成员的项目工作台。\n"
        "- 使用：维护里程碑与任务计划跟踪进度；问题单记录风险；项目列表行内"
        "「发起团队」可带着本项目上下文唤起 AI 智能体团队。"
    )

    if len(proj_lines) <= 1:
        return None
    return "\n".join(proj_lines)
