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
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.change.model import Change, ChangeDocument
from app.modules.change.service import ChangeService
from app.modules.workspace.model import Workspace

log = get_logger(__name__)

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
    "settings_providers": "设置 · 模型供应商",
    "settings_api_keys": "设置 · API 密钥",
    "settings_git_identities": "设置 · Git 身份",
    "settings": "设置",
    "runtimes": "运行时",
    "runtimes_audit": "运行时 · 机器审计",
    "workspaces": "工作区列表",
    "workspace_detail": "工作区详情",
    "agent_profiles": "智能体档案",
    "sessions_portal": "会话门户",
    "ppm_home": "PPM · 项目管理",
    "ppm_projects": "PPM · 项目列表",
    "ppm_workbench": "PPM · 工作台",
    "ppm_milestone_details": "PPM · 里程碑详情",
    "ppm_problem_list": "PPM · 问题单",
    "ppm_task_plans": "PPM · 任务计划",
    "ppm_task_execute": "PPM · 任务执行",
    "ppm_project_plans": "PPM · 项目计划",
    "ppm_plan_nodes": "PPM · 计划节点",
    "ppm_weekly_plan": "PPM · 周计划",
    "ppm_kanban": "PPM · 看板",
    "ppm_work_hours": "PPM · 工时填报",
    "ppm_work_hour_statistics": "PPM · 工时统计",
    "ppm_project_members": "PPM · 项目成员",
    "ppm_project_stakeholders": "PPM · 干系人",
    "ppm_customers": "PPM · 客户",
    "admin": "管理后台",
    "admin_organizations": "管理后台 · 组织",
    "admin_users": "管理后台 · 用户",
    "admin_roles": "管理后台 · 角色权限",
    "account": "个人中心",
}

# 工作区详情子页面（tab）注册表（用户反馈⑧：每个子菜单独立说明书）：
# tab_key → 子页面中文名。前端 hook 从 /workspaces/:id/<tab> 路径段派生
# tab_key 随 workspace 块上送；说明书优先取 tab 文档，未命中回落
# workspace_detail 总览。tabs 不进 PAGE_ROUTE_LABELS（无独立路由键语义），
# 完整性守护测试覆盖 PPM_PROJECT_MANUAL_KEY 与本表。
WORKSPACE_TAB_LABELS: dict[str, str] = {
    "workspace_overview": "概览",
    "workspace_changes": "变更",
    "workspace_change_detail": "变更详情",
    "workspace_change_sessions": "变更会话",
    "workspace_sessions_tab": "会话",
    "workspace_explorer": "文件",
    "workspace_knowledge": "知识库",
    "workspace_components": "组件",
    "workspace_topology": "组件拓扑",
    "workspace_scan_docs": "扫描文档",
    "workspace_runtime_tab": "运行时",
    "workspace_agent_profiles_tab": "智能体档案",
    "workspace_agent": "Agent 总览",
    "workspace_skills_tab": "Skills",
    "workspace_mcp_tab": "MCP",
    "workspace_mcp_tokens_tab": "MCP 令牌",
    "workspace_members": "成员",
    "workspace_files": "方案文件",
    "workspace_approvals": "审批中心",
    "workspace_audit": "审计日志",
    "workspace_git_log": "Git 提交记录",
    "workspace_incidents": "事件",
    "workspace_releases": "发布",
}

# 页面说明书知识库（task-13 起步为内联小抄，ql-20260825-008 升级为独立文档
# 文件）：page_docs/<键>.md 每页一份结构化说明书（功能定位 / 核心概念 /
# 页面结构与操作 / 典型工作流 / 常见问题），服务端静态知识与代码同仓演进
# （backend Dockerfile `COPY . .` 整树进镜像，部署零额外配置），随【页面上下文】
# 前导注入——AI 即获得"这是什么页面 / 用户在做什么 / 怎么指导使用"的完整背景。
# 读失败的页静默降级为"仅标签"（不阻断会话创建）；键覆盖完整性由
# tests/test_page_context_preamble.py::TestPageManualsIntegrity 守护。
_PAGE_DOCS_DIR = Path(__file__).resolve().parent / "page_docs"

# ppm_project 实体详情页说明书键（实体页无 route_key，不入 PAGE_ROUTE_LABELS）。
PPM_PROJECT_MANUAL_KEY = "ppm_project_detail"


# 用户反馈⑨（全局意识）：平台全局地图——跨页面逻辑关系与主使用动线，
# 随所有【页面上下文】前导附注（page_docs/_platform_map.md，下划线前缀
# 非路由键；读失败 → 空串不附注）。AI 据此可做跨页引导（"这个功能在哪个
# 页面/接下来该去哪"）。
def _load_platform_map() -> str:
    try:
        return (_PAGE_DOCS_DIR / "_platform_map.md").read_text(encoding="utf-8").strip()
    except OSError:
        log.warning("page_manual.platform_map_missing")
        return ""


PLATFORM_MAP: str = _load_platform_map()


def _load_page_manuals() -> dict[str, str]:
    manuals: dict[str, str] = {}
    for key in (*PAGE_ROUTE_LABELS, *WORKSPACE_TAB_LABELS, PPM_PROJECT_MANUAL_KEY):
        try:
            text = (_PAGE_DOCS_DIR / f"{key}.md").read_text(encoding="utf-8").strip()
        except OSError:
            log.warning("page_manual.missing", page_key=key)
            continue
        if text:
            manuals[key] = text
    return manuals


PAGE_MANUALS: dict[str, str] = _load_page_manuals()


async def build_page_context_preamble(
    db: AsyncSession,
    page_key: str | None,
    project_id: uuid.UUID | None,
    route_key: str | None = None,
    workspace_id: uuid.UUID | None = None,
    tab_key: str | None = None,
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
        # 用户反馈⑦：指令式前导（"当前用户正在访问…请参考"）+ 不注入本机
        # root_path（宿主机路径对他人无意义且属环境信息泄露）；只保留
        # 名称/类型。
        # 用户反馈⑧：子页面说明书优先（tab_key 注册表 Lookup），未命中回落
        # workspace_detail 总览；子页面行标注当前 tab；全局地图见 PLATFORM_MAP。
        tab_label = WORKSPACE_TAB_LABELS.get(tab_key or "")
        manual = (
            PAGE_MANUALS.get(tab_key or "") if tab_label is not None else None
        ) or PAGE_MANUALS.get("workspace_detail")
        lines = [
            "【页面上下文】",
            "当前用户正在访问本平台的「工作区详情」页面，可能基于此页面内容向你提问；"
            "本页面包含的功能和说明如下，请优先据此回答（与页面无关的问题按常规理解作答）。",
        ]
        if ws.name:
            lines.append(f"- 当前工作区：{ws.name[:_PAGE_VALUE_MAX]}")
        if ws.type:
            lines.append(f"- 类型：{ws.type[:_PAGE_VALUE_MAX]}")
        if tab_label is not None:
            lines.append(f"- 当前子页面：{tab_label}")
        if manual:
            lines.append(manual)
        if PLATFORM_MAP:
            lines.append(PLATFORM_MAP)
        if len(lines) <= 2:
            return None
        return "\n".join(lines)
    if page_key == "generic_page":
        key = route_key or ""
        label = PAGE_ROUTE_LABELS.get(key)
        if label is None:
            return None
        # 用户反馈⑦：指令式前导——直接告诉 AI"用户在这个页面、可能问页面
        # 内容、参考以下说明回答"。
        parts = [
            "【页面上下文】",
            f"当前用户正在访问本平台的「{label}」页面，可能基于此页面内容向你提问；"
            "本页面包含的功能和说明如下，请优先据此回答（与页面无关的问题按常规理解作答）。",
        ]
        manual = PAGE_MANUALS.get(key)
        if manual:
            parts.append(manual)
        if PLATFORM_MAP:
            parts.append(PLATFORM_MAP)
        return "\n".join(parts)

    if page_key != "ppm_project" or project_id is None:
        return None

    from app.modules.ppm.project.model import PpmProjectMaintenance

    project = await db.get(PpmProjectMaintenance, project_id)
    if project is None:
        return None

    # 用户反馈⑦：指令式前导 + 业务字段（名称/编码/状态/周期是平台业务数据，
    # 保留；不含任何本机路径）。
    proj_lines = [
        "【页面上下文】",
        "当前用户正在访问本平台的「PPM · 项目详情」页面，可能基于此页面内容向你提问；"
        "本页面包含的功能和说明如下，请优先据此回答（与页面无关的问题按常规理解作答）。",
    ]
    if project.project_name:
        proj_lines.append(f"- 当前项目：{project.project_name[:_PAGE_VALUE_MAX]}")
    if project.project_code:
        proj_lines.append(f"- 项目编码：{project.project_code[:_PAGE_VALUE_MAX]}")
    if project.project_status:
        proj_lines.append(f"- 状态：{project.project_status[:_PAGE_VALUE_MAX]}")
    if project.project_effective_start_time:
        proj_lines.append(f"- 周期起：{project.project_effective_start_time.date().isoformat()}")
    if project.project_effective_end_time:
        proj_lines.append(f"- 周期止：{project.project_effective_end_time.date().isoformat()}")
    proj_manual = PAGE_MANUALS.get(PPM_PROJECT_MANUAL_KEY)
    if proj_manual:
        proj_lines.append(proj_manual)
    if PLATFORM_MAP:
        proj_lines.append(PLATFORM_MAP)

    if len(proj_lines) <= 2:
        return None
    return "\n".join(proj_lines)


# ── PPM 条目上下文前导（2026-08-28-session-ppm-task-binding / FR-03 / D-006/D-007）──
#
# 会话绑定 PPM 任务/问题后的首轮【PPM 任务上下文】/【问题上下文】前导：数据
# 全部服务端回查（task-01 load_ppm_item），字段拼装模式与
# build_change_context_preamble 同构（X-02 纯后端，零 daemon 改动）——dispatch
# prompt 通道注入，AgentRunLog(user_input) 与 SESSION_INJECT 展示层保持干净
# 用户消息。attachment_lines 由调用方（task-03 _materialize_ppm_attachments）
# 产出：物化失败的降级条目（无权/超限/非 claude/读取失败/已删）逐行拼成尾部
# 附件清单段，AI 据此引导用户经 GET /api/file/{file_id} 自取。

# 描述字段（PlanTask.task_description / PpmProblemList.pro_desc 均为 Text 长文本）
# 截断上限——单值截断沿用 _PAGE_VALUE_MAX（120）口径，描述作为条目核心载荷
# 放宽到 1000 控制前导总长度。
_PPM_DESC_MAX: int = 1000


async def build_ppm_item_context_preamble(
    db: AsyncSession,
    kind: str,
    item_id: uuid.UUID | None,
    *,
    attachment_lines: list[str],
) -> str | None:
    """拼装【PPM 任务上下文】/【问题上下文】前导字符串（design §5 Phase 2 / §7）。

    - 经 task-01 :func:`load_ppm_item` 回查条目；``item_id`` 为 None 或查无
      条目时返回 None（调用方据此跳过注入、不报错，design §9）。
    - ``kind="plan_task"``：标题=content、描述=task_description、状态、项目=
      project_name、模块=module_name、责任人=user_name、周期=start_time~end_time。
    - ``kind="problem"``：标题=pro_desc（问题单无独立标题列）、状态、项目=
      project_name、模块=model_name、责任人=duty_user_name、周期=
      plan_start_time~plan_end_time。
    - ``attachment_lines`` 非空时追加尾部「附件清单」段（每行一条，内容为
      物化降级条目）；空列表不渲染该段。
    """
    if item_id is None:
        return None

    from app.modules.ppm.common.session_binding import load_ppm_item

    item = await load_ppm_item(db, kind, item_id)  # type: ignore[arg-type]
    if item is None:
        return None

    def _period(start: object, end: object) -> str | None:
        start_s = start.date().isoformat() if start is not None else None
        end_s = end.date().isoformat() if end is not None else None
        if start_s and end_s:
            return f"{start_s} ~ {end_s}"
        return start_s or end_s

    lines: list[str]
    if kind == "plan_task":
        lines = ["【PPM 任务上下文】"]
        if item.content:
            lines.append(f"- 标题：{item.content[:_PAGE_VALUE_MAX]}")
        if item.task_description:
            lines.append(f"- 描述：{item.task_description[:_PPM_DESC_MAX]}")
        if item.status:
            lines.append(f"- 状态：{item.status[:_PAGE_VALUE_MAX]}")
        if item.project_name:
            lines.append(f"- 项目：{item.project_name[:_PAGE_VALUE_MAX]}")
        if item.module_name:
            lines.append(f"- 模块：{item.module_name[:_PAGE_VALUE_MAX]}")
        if item.user_name:
            lines.append(f"- 责任人：{item.user_name[:_PAGE_VALUE_MAX]}")
        period = _period(item.start_time, item.end_time)
        if period:
            lines.append(f"- 周期：{period}")
    else:
        lines = ["【问题上下文】"]
        if item.pro_desc:
            lines.append(f"- 标题：{item.pro_desc[:_PPM_DESC_MAX]}")
        if item.status:
            lines.append(f"- 状态：{item.status[:_PAGE_VALUE_MAX]}")
        if item.project_name:
            lines.append(f"- 项目：{item.project_name[:_PAGE_VALUE_MAX]}")
        if item.model_name:
            lines.append(f"- 模块：{item.model_name[:_PAGE_VALUE_MAX]}")
        if item.duty_user_name:
            lines.append(f"- 责任人：{item.duty_user_name[:_PAGE_VALUE_MAX]}")
        period = _period(item.plan_start_time, item.plan_end_time)
        if period:
            lines.append(f"- 周期：{period}")

    if attachment_lines:
        lines.append("- 附件清单：")
        for line in attachment_lines:
            lines.append(f"  - {line}")

    return "\n".join(lines)
