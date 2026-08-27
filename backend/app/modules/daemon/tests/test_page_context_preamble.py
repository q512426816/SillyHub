"""2026-08-25-unified-floating-session：页面上下文前导（FR-5 / D-005）。

覆盖三层：
- A. ``build_page_context_preamble`` 纯逻辑单测（镜像 test_change_session.py
  §A 范式）：None 入参 / 查无项目 → None；命中 → 【页面上下文】含项目名/
  编码/状态，单值 120 截断。
- B. schema 校验：非法 page_key → ValidationError（422 同源）。
- C. create 路径拼接（镜像 test_session_team_mission.py t09 范式）：lease
  metadata prompt 含【页面上下文】且在用户消息之前；AgentRunLog(user_input)
  保持干净用户原文（展示层干净）；不传 page_context 逐字节零回归。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRunLog
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.schema import PageContextCreateBlock
from app.modules.ppm.project.model import PpmProjectMaintenance

# ── helpers（t09 同款：mock hub/redis + user/runtime 种子）────────────────────


def _mock_hub(*, connected: bool = True):
    from unittest.mock import AsyncMock, MagicMock

    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    from unittest.mock import patch

    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    from unittest.mock import AsyncMock, patch

    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _create_user(db_session) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"uf-{uid}@example.com",
            password_hash="x",
            display_name="UF",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _create_runtime(db_session, user_id: uuid.UUID):
    from app.modules.daemon.model import DaemonRuntime

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon-claude",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    return rt


async def _make_project(db_session, **overrides) -> PpmProjectMaintenance:
    kw = dict(
        id=uuid.uuid4(),
        project_name="智慧园区一期",
        project_code="PM-2026-001",
        project_status="进行中",
    )
    kw.update(overrides)
    p = PpmProjectMaintenance(**kw)
    db_session.add(p)
    await db_session.commit()
    return p


# ── A. build_page_context_preamble 单测 ──────────────────────────────────────


class TestBuildPageContextPreamble:
    @pytest.mark.asyncio
    async def test_none_inputs_return_none(self, db_session: AsyncSession) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        assert await build_page_context_preamble(db_session, None, None) is None
        assert await build_page_context_preamble(db_session, "ppm_project", None) is None
        # 未知枚举（服务层 Literal 已挡，构建器兜底同语义）。
        assert await build_page_context_preamble(db_session, "other_page", uuid.uuid4()) is None

    @pytest.mark.asyncio
    async def test_unknown_project_returns_none(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        assert await build_page_context_preamble(db_session, "ppm_project", uuid.uuid4()) is None

    @pytest.mark.asyncio
    async def test_valid_project_produces_preamble(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        project = await _make_project(db_session)
        preamble = await build_page_context_preamble(db_session, "ppm_project", project.id)
        assert preamble is not None
        assert "【页面上下文】" in preamble
        assert "PPM · 项目详情" in preamble
        assert "智慧园区一期" in preamble
        assert "PM-2026-001" in preamble
        assert "进行中" in preamble
        # ql-20260825-008：ppm 实体页说明书同样来自 page_docs/*.md。
        assert "## 功能定位" in preamble

    @pytest.mark.asyncio
    async def test_long_values_truncated_to_120(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        project = await _make_project(db_session, project_name="超" * 300, project_code="C" * 200)
        preamble = await build_page_context_preamble(db_session, "ppm_project", project.id)
        assert preamble is not None
        assert "超" * 120 in preamble
        assert "超" * 121 not in preamble
        assert "C" * 120 in preamble
        assert "C" * 121 not in preamble


# ── B. schema 校验 ────────────────────────────────────────────────────────────


class TestPageContextSchema:
    def test_valid_block_accepted(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        blk = PageContextCreateBlock(page_key="ppm_project", project_id=uuid.uuid4())
        assert blk.page_key == "ppm_project"

    def test_invalid_page_key_rejected(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        with pytest.raises(ValidationError):
            PageContextCreateBlock(page_key="workspace_overview", project_id=uuid.uuid4())

    def test_project_id_required(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        with pytest.raises(ValidationError):
            PageContextCreateBlock(page_key="ppm_project")

    # ── task-09：generic_page 通用页面块 ────────────────────────────────────

    def test_generic_page_valid(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        blk = PageContextCreateBlock(page_key="generic_page", route_key="settings_mcp")
        assert blk.route_key == "settings_mcp"

    def test_generic_page_route_key_required(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        with pytest.raises(ValidationError):
            PageContextCreateBlock(page_key="generic_page")

    def test_generic_page_route_key_format_rejected(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        # 大写/空格/中文等非法格式 → 422（枚举键语义约束）。
        with pytest.raises(ValidationError):
            PageContextCreateBlock(page_key="generic_page", route_key="Bad Key!")


class TestGenericPagePreamble:
    """task-09：generic_page 注册表 Lookup 前导。"""

    @pytest.mark.asyncio
    async def test_registered_route_key_produces_label(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        out = await build_page_context_preamble(db_session, "generic_page", None, "settings_mcp")
        assert out is not None
        # 用户反馈⑦：指令式前导 + 专业说明书结构。
        assert "当前用户正在访问本平台的「设置 · MCP」页面" in out
        assert "请优先据此回答" in out
        assert "## 功能定位" in out
        assert "## 页面结构与操作" in out
        assert "MCP" in out

    @pytest.mark.asyncio
    async def test_unknown_route_key_returns_none(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        assert (
            await build_page_context_preamble(db_session, "generic_page", None, "not_a_page")
            is None
        )
        assert await build_page_context_preamble(db_session, "generic_page", None, None) is None


class TestPageManualsIntegrity:
    """ql-20260825-008：page_docs/*.md 知识库完整性守护——每个注册页面
    （含 ppm_project 实体页）都必须有非空说明书，且为结构化专业文档
    （含「功能定位」章节），防"加了注册键忘了写说明书"静默退化。"""

    def test_every_registered_page_has_structured_manual(self) -> None:
        from app.modules.daemon.session.context import (
            PAGE_MANUALS,
            PAGE_ROUTE_LABELS,
            PPM_PROJECT_MANUAL_KEY,
            WORKSPACE_TAB_LABELS,
        )

        expected_keys = {*PAGE_ROUTE_LABELS, PPM_PROJECT_MANUAL_KEY, *WORKSPACE_TAB_LABELS}
        assert set(PAGE_MANUALS) == expected_keys
        for key, text in PAGE_MANUALS.items():
            assert "## 功能定位" in text, key


# ── C. create 路径拼接（t09 范式）────────────────────────────────────────────


class TestCreatePathInjection:
    @pytest.mark.asyncio
    async def test_lease_prompt_carries_preamble_user_log_clean(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        project = await _make_project(db_session)

        user_prompt = "这个项目本周有什么风险？"
        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt=user_prompt,
            page_context=PageContextCreateBlock(page_key="ppm_project", project_id=project.id),
        )

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        meta_prompt = (lease.metadata_ or {}).get("prompt", "")
        assert "【页面上下文】" in meta_prompt
        assert "智慧园区一期" in meta_prompt
        assert meta_prompt.index("【页面上下文】") < meta_prompt.index(user_prompt)
        assert "\n\n---\n\n" in meta_prompt

        # 展示层干净：AgentRunLog(user_input) 只写用户原文。
        log = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == result.agent_run.id)
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert "【页面上下文】" not in (log.content_redacted or "")
        assert user_prompt in (log.content_redacted or "")

    @pytest.mark.asyncio
    async def test_without_page_context_regression_free(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        user_prompt = "普通对话"
        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt=user_prompt)

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        assert (lease.metadata_ or {}).get("prompt") == user_prompt

    @pytest.mark.asyncio
    async def test_unknown_project_id_creates_session_without_preamble(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """查无项目：会话正常创建、前导静默不注入（不 4xx 不阻断）。"""
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        user_prompt = "继续聊"
        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt=user_prompt,
            page_context=PageContextCreateBlock(page_key="ppm_project", project_id=uuid.uuid4()),
        )

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        assert (lease.metadata_ or {}).get("prompt") == user_prompt


class TestWorkspacePreamble:
    """task-10：workspace 实体回查前导（用户实测反馈迭代）。"""

    @pytest.mark.asyncio
    async def test_workspace_hit_produces_entity_preamble(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble
        from app.modules.workspace.model import Workspace

        ws = Workspace(
            id=uuid.uuid4(),
            name="multi-agent-platform",
            slug="map",
            root_path="C:/repo/map",
            status="active",
            type="app",
        )
        db_session.add(ws)
        await db_session.commit()

        out = await build_page_context_preamble(db_session, "workspace", None, None, ws.id)
        assert out is not None
        assert "【页面上下文】" in out
        assert "工作区详情" in out
        assert "multi-agent-platform" in out
        assert "app" in out
        # 用户反馈⑦：指令式前导 + 本机路径不再注入（环境信息不外泄）。
        assert "当前用户正在访问本平台的「工作区详情」页面" in out
        assert "请优先据此回答" in out
        assert "C:/repo/map" not in out
        # task-13：实体 + 工作区页面说明书（ql-20260825-008 起为 md 结构化文档）。
        assert "## 功能定位" in out

    @pytest.mark.asyncio
    async def test_workspace_unknown_id_returns_none(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        assert (
            await build_page_context_preamble(db_session, "workspace", None, None, uuid.uuid4())
            is None
        )

    def test_workspace_block_requires_workspace_id(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        with pytest.raises(ValidationError):
            PageContextCreateBlock(page_key="workspace")


class TestPageDocsDockerignoreGuard:
    """ql-20260825-008 追加（用户实测会话 1ad69ea4 根因）：page_docs/*.md 必须
    能进 Docker 镜像——backend/.dockerignore 的 `**/*.md` 排除规则会吃掉全部
    markdown，说明书文件"源码在、镜像丢"，加载器静默降级为仅标签。守护 =
    白名单行必须存在（与 change/prompts 同款先例）。"""

    def test_dockerignore_whitelists_page_docs(self) -> None:
        from pathlib import Path

        di = Path(__file__).resolve().parents[4] / ".dockerignore"
        text = di.read_text(encoding="utf-8")
        assert "!app/modules/daemon/session/page_docs/*.md" in text, (
            "backend/.dockerignore 缺 page_docs 白名单——说明书文件进不了镜像，"
            "运行时静默降级为仅标签（用户实测 1ad69ea4 根因）"
        )


class TestWorkspaceTabManuals:
    """用户反馈⑧/⑨：工作区子菜单说明书 + 全局地图。"""

    @pytest.mark.asyncio
    async def test_tab_key_selects_tab_manual_with_subpage_line(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble
        from app.modules.workspace.model import Workspace

        ws = Workspace(
            id=uuid.uuid4(),
            name="map",
            slug="map",
            root_path="C:/x",
            status="active",
            type="app",
        )
        db_session.add(ws)
        await db_session.commit()

        out = await build_page_context_preamble(
            db_session, "workspace", None, None, ws.id, "workspace_changes"
        )
        assert out is not None
        assert "- 当前子页面：变更" in out
        assert "规范驱动开发" in out  # 变更 tab 说明书内容特征

    @pytest.mark.asyncio
    async def test_unknown_tab_falls_back_to_overview(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble
        from app.modules.workspace.model import Workspace

        ws = Workspace(
            id=uuid.uuid4(),
            name="map2",
            slug="map2",
            root_path="C:/y",
            status="active",
            type="app",
        )
        db_session.add(ws)
        await db_session.commit()

        out = await build_page_context_preamble(
            db_session, "workspace", None, None, ws.id, "no_such_tab"
        )
        assert out is not None
        assert "当前子页面" not in out
        assert "## 功能定位" in out  # 回落总览说明书

    def test_platform_map_loaded_and_injected(self) -> None:
        from app.modules.daemon.session.context import PLATFORM_MAP

        assert "平台全局地图" in PLATFORM_MAP
        assert "主使用动线" in PLATFORM_MAP
        assert "PPM 业务链" in PLATFORM_MAP


# ── task-03（2026-08-28-session-ppm-task-binding / FR-03）：PPM 条目前导单测 ───


class TestPpmItemContextPreamble:
    """build_ppm_item_context_preamble 纯逻辑单测（镜像 §A 范式）：查无 → None；
    命中 → 全字段前导；attachment_lines 尾部附件清单段（空列表不渲染）。"""

    @pytest.mark.asyncio
    async def test_item_missing_returns_none(self, db_session) -> None:
        from app.modules.daemon.session.context import build_ppm_item_context_preamble

        assert (
            await build_ppm_item_context_preamble(
                db_session, "plan_task", uuid.uuid4(), attachment_lines=[]
            )
            is None
        )
        assert (
            await build_ppm_item_context_preamble(
                db_session, "problem", uuid.uuid4(), attachment_lines=["x"]
            )
            is None
        )
        assert (
            await build_ppm_item_context_preamble(
                db_session, "plan_task", None, attachment_lines=[]
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_plan_task_preamble_full_fields(self, db_session) -> None:
        from datetime import UTC
        from datetime import datetime as _dt

        from app.modules.daemon.session.context import build_ppm_item_context_preamble
        from app.modules.ppm.task.model import PlanTask

        tid = uuid.uuid4()
        db_session.add(
            PlanTask(
                id=tid,
                user_id=uuid.uuid4(),
                content="升级网关依赖",
                task_description="梳理兼容性风险并灰度",
                status="进行中",
                project_name="智慧园区二期",
                module_name="网关模块",
                user_name="王五",
                start_time=_dt(2026, 9, 1, tzinfo=UTC),
                end_time=_dt(2026, 9, 10, tzinfo=UTC),
                file_urls=[],
            )
        )
        await db_session.commit()

        out = await build_ppm_item_context_preamble(
            db_session, "plan_task", tid, attachment_lines=[]
        )
        assert out is not None
        assert out.startswith("【PPM 任务上下文】")
        for field in (
            "- 标题：升级网关依赖",
            "- 描述：梳理兼容性风险并灰度",
            "- 状态：进行中",
            "- 项目：智慧园区二期",
            "- 模块：网关模块",
            "- 责任人：王五",
            "- 周期：2026-09-01 ~ 2026-09-10",
        ):
            assert field in out, field
        # attachment_lines 为空 → 不渲染附件清单段。
        assert "附件清单" not in out

    @pytest.mark.asyncio
    async def test_problem_preamble_full_fields(self, db_session) -> None:
        from datetime import UTC
        from datetime import datetime as _dt

        from app.modules.daemon.session.context import build_ppm_item_context_preamble
        from app.modules.ppm.problem.model import PpmProblemList

        pid = uuid.uuid4()
        db_session.add(
            PpmProblemList(
                id=pid,
                project_id=uuid.uuid4(),
                project_name="智慧园区三期",
                model_name="支付模块",
                pro_desc="退款偶发双倍",
                status="新建",
                duty_user_name="赵六",
                plan_start_time=_dt(2026, 9, 2, tzinfo=UTC),
                plan_end_time=_dt(2026, 9, 8, tzinfo=UTC),
                file_urls=[],
            )
        )
        await db_session.commit()

        out = await build_ppm_item_context_preamble(db_session, "problem", pid, attachment_lines=[])
        assert out is not None
        assert out.startswith("【问题上下文】")
        for field in (
            "- 标题：退款偶发双倍",
            "- 状态：新建",
            "- 项目：智慧园区三期",
            "- 模块：支付模块",
            "- 责任人：赵六",
            "- 周期：2026-09-02 ~ 2026-09-08",
        ):
            assert field in out, field

    @pytest.mark.asyncio
    async def test_attachment_lines_rendered_as_tail_section(self, db_session) -> None:
        """attachment_lines 非空 → 尾部「附件清单」段逐行渲染（物化降级条目）。"""
        from app.modules.daemon.session.context import build_ppm_item_context_preamble
        from app.modules.ppm.task.model import PlanTask

        tid = uuid.uuid4()
        db_session.add(PlanTask(id=tid, user_id=uuid.uuid4(), content="带附件的任务", file_urls=[]))
        await db_session.commit()

        lines = ["机密方案.pdf（无权访问）", f"说明.pdf：GET /api/file/{uuid.uuid4()}"]
        out = await build_ppm_item_context_preamble(
            db_session, "plan_task", tid, attachment_lines=lines
        )
        assert out is not None
        assert "- 附件清单：" in out
        assert f"  - {lines[0]}" in out
        assert f"  - {lines[1]}" in out
        # 附件清单段在尾部（最后一个字段行之后）。
        assert out.index("附件清单") > out.index("- 标题：带附件的任务")
