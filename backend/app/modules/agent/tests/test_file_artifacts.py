"""agent 文件制品端点测试（2026-08-23-agent-file-upload-mcp task-03 / design §7.2）。

覆盖 task-03 acceptance：
- POST 会话场景 201：FileUploadResp 含 description、File 行 owner_type/owner_id、
  AgentRunLog tool_kind='FileUpload' 行 content 六契约字段、Redis 双通道 publish。
- 会话无任何 run → 422 中文文案（CJK 断言）；run_id 不存在 → 404；缺上下文 422。
- worker 场景（run_id + mission 锚）201，仅 run 通道 publish。
- 越权 workspace → 403（require_permission_any 门 + 锚复核双层）。
- JWT 与 X-API-Key 双路径鉴权均可达。
- 同 file_id 重放（撞 dedup 唯一索引 IntegrityError）不 500；publish 异常仅降级仍 201。
- GET 按 session_id/run_id 返 FileMetaResp（description/created_at）倒序；无
  WORKSPACE_READ → 403。
- 会话归属人制（ql-20260823-013）：无工作区会话归属人可传可列（201/200），
  非归属人 403；workspace 会话归属人无 ws 角色同样放行（脱钩工作区）。
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.db import get_session
from app.main import app
from app.modules.agent.model import AgentMission, AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.file.model import File
from app.modules.file.schema import FileUploadResp
from app.modules.file.service import FileService
from app.modules.storage.base import ObjectStat, StorageBackend
from app.modules.storage.factory import get_storage_backend
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Fixtures：MockStorage + 挂载依赖覆盖的客户端（file/tests/conftest.py 同款）
# ---------------------------------------------------------------------------


class MockStorage(StorageBackend):
    """内存存储后端（不依赖真实 MinIO，模块卡 file.md 测试替身）。"""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    async def get_object_stream(self, key: str) -> AsyncIterator[bytes]:
        data, _ = self.objects[key]
        yield data

    async def delete_object(self, key: str) -> None:
        self.objects.pop(key, None)

    async def head_object(self, key: str) -> ObjectStat:
        data, ctype = self.objects[key]
        return ObjectStat(size=len(data), content_type=ctype)


@pytest.fixture()
def mock_storage() -> MockStorage:
    return MockStorage()


@pytest.fixture()
async def artifact_client(db_engine: Any, mock_storage: MockStorage) -> AsyncIterator[AsyncClient]:
    """挂载 get_session + get_storage_backend 覆盖的 HTTP 客户端（同一测试 engine）。"""
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_storage_backend] = lambda: mock_storage
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_storage_backend, None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


async def _seed_workspace(session: AsyncSession, name: str = "文件制品工作区") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex}",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _seed_agent_session(
    session: AsyncSession,
    ws_id: uuid.UUID | None,
    user_id: uuid.UUID | None = None,
) -> AgentSession:
    agent_session = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id or uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=ws_id,
    )
    session.add(agent_session)
    await session.commit()
    await session.refresh(agent_session)
    return agent_session


async def _seed_run(
    session: AsyncSession,
    *,
    agent_session_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    run_status: str = "running",
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_session_id=agent_session_id,
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _seed_mission(session: AsyncSession, ws_id: uuid.UUID) -> AgentMission:
    mission = AgentMission(workspace_id=ws_id, objective="批任务目标")
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


async def _make_user(session: AsyncSession, *, is_admin: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="not-a-real-hash",
        display_name="普通成员",
        status="active",
        is_platform_admin=is_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _grant_ws_permission(
    session: AsyncSession, *, user: User, workspace_id: uuid.UUID, permission: str
) -> None:
    """给用户在指定 workspace 授一个只含单权限的角色（test_mission_access_control 同款）。"""
    role_id = uuid.uuid4()
    session.add(
        Role(
            id=role_id,
            key=f"role-{role_id.hex[:8]}",
            name=f"Role {role_id.hex[:8]}",
            description="test role",
        )
    )
    session.add(RolePermission(role_id=role_id, permission=permission))
    session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await session.commit()


def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


def _png_form(description: str = "架构图", **extra: str) -> dict[str, Any]:
    form: dict[str, Any] = {"file": ("报告截图.png", b"\x89PNG\r\n\x1a\n-fake", "image/png")}
    data = {"description": description, **extra}
    return {"files": form, "data": data}


async def _file_upload_logs(session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    stmt = (
        select(AgentRunLog)
        .where(
            AgentRunLog.run_id == run_id,
            AgentRunLog.tool_kind == "FileUpload",
        )
        .order_by(AgentRunLog.timestamp)
    )
    return list((await session.execute(stmt)).scalars().all())


# ---------------------------------------------------------------------------
# POST 会话场景：上传落库 + 日志行 + 双通道 publish
# ---------------------------------------------------------------------------


class TestUploadSessionScenario:
    async def test_post_uploads_file_writes_log_and_publishes(
        self, artifact_client, db_session, auth_headers
    ) -> None:
        """会话场景 201：六字段契约全链路（File 行 / 日志行 / 双通道 publish）。"""
        ws = await _seed_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        active_run = await _seed_run(db_session, agent_session_id=agent_session.id)

        mock_redis = AsyncMock()
        mock_redis.publish = AsyncMock()
        with patch("app.modules.agent.file_artifacts.get_redis", return_value=mock_redis):
            resp = await artifact_client.post(
                "/api/agent/file-artifacts",
                headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
                **_png_form(description="会话产物说明"),
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["original_name"] == "报告截图.png"
        assert body["mime_type"] == "image/png"
        assert body["size"] == len(b"\x89PNG\r\n\x1a\n-fake")
        assert body["description"] == "会话产物说明"
        file_id = uuid.UUID(body["id"])

        # File 行归属（D-006@v2：owner_type=agent_session）
        file_row = await db_session.get(File, file_id)
        assert file_row is not None
        assert file_row.owner_type == "agent_session"
        assert file_row.owner_id == agent_session.id
        assert file_row.uploaded_by is not None

        # AgentRunLog 日志行（D-007@v1：六字段 JSON + dedup_key）
        logs = await _file_upload_logs(db_session, active_run.id)
        assert len(logs) == 1
        content = json.loads(logs[0].content_redacted or "")
        assert content["file_id"] == str(file_id)
        assert content["original_name"] == "报告截图.png"
        assert content["size"] == body["size"]
        assert content["mime_type"] == "image/png"
        assert content["description"] == "会话产物说明"
        assert content["created_at"]
        assert logs[0].channel == "tool_call"
        assert logs[0].dedup_key == f"file-upload:{file_id}"

        # Redis 双通道 publish（D-011@v1）：run 日志流 + 会话流
        channels = [c.args[0] for c in mock_redis.publish.call_args_list]
        assert set(channels) == {
            f"agent_run:{active_run.id}",
            f"agent_session:{agent_session.id}",
        }
        for c in mock_redis.publish.call_args_list:
            payload = json.loads(c.args[1])
            assert payload["tool_kind"] == "FileUpload"
            assert payload["log_id"] == str(logs[0].id)

    async def test_post_falls_back_to_latest_run_when_no_active(
        self, artifact_client, db_session, auth_headers
    ) -> None:
        """无活跃 run（turn 间隙）→ 挂最新 run 兜底（design §7.2 / R-05）。"""
        ws = await _seed_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        latest_run = await _seed_run(
            db_session, agent_session_id=agent_session.id, run_status="completed"
        )

        with patch("app.modules.agent.file_artifacts.get_redis", return_value=AsyncMock()):
            resp = await artifact_client.post(
                "/api/agent/file-artifacts",
                headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
                **_png_form(),
            )
        assert resp.status_code == 201, resp.text
        logs = await _file_upload_logs(db_session, latest_run.id)
        assert len(logs) == 1

    async def test_post_session_without_any_run_422_cjk(
        self, artifact_client, db_session, auth_headers
    ) -> None:
        """会话无任何 run → 422 中文文案（l10n 断言 CJK），无落库副作用。"""
        ws = await _seed_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)

        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
            **_png_form(),
        )
        assert resp.status_code == 422, resp.text
        message = resp.json()["message"]
        assert _has_cjk(message)
        files = (
            (await db_session.execute(select(File).where(File.owner_type == "agent_session")))
            .scalars()
            .all()
        )
        assert files == []

    async def test_post_missing_context_422(self, artifact_client, auth_headers) -> None:
        """既无 X-Session-Id 又无 run_id → 422 中文引导。"""
        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers=auth_headers,
            **_png_form(),
        )
        assert resp.status_code == 422, resp.text
        assert _has_cjk(resp.json()["message"])

    async def test_post_unknown_session_404(self, artifact_client, auth_headers) -> None:
        """X-Session-Id 指向不存在的会话 → 404。"""
        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers={**auth_headers, "X-Session-Id": str(uuid.uuid4())},
            **_png_form(),
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# POST worker 场景（run_id）：校验 404 + mission 锚 + 仅 run 通道 publish
# ---------------------------------------------------------------------------


class TestUploadWorkerScenario:
    async def test_post_by_run_id_uploads(self, artifact_client, db_session, auth_headers) -> None:
        """worker 场景：run_id 校验通过 → owner_type=agent_run + 日志行挂该 run。"""
        ws = await _seed_workspace(db_session)
        mission = await _seed_mission(db_session, ws.id)
        worker_run = await _seed_run(db_session, mission_id=mission.id)

        mock_redis = AsyncMock()
        mock_redis.publish = AsyncMock()
        with patch("app.modules.agent.file_artifacts.get_redis", return_value=mock_redis):
            resp = await artifact_client.post(
                "/api/agent/file-artifacts",
                headers=auth_headers,
                files={"file": ("导出数据.zip", b"PK\x03\x04fake", "application/zip")},
                data={"description": "批任务产物", "run_id": str(worker_run.id)},
            )
        assert resp.status_code == 201, resp.text
        file_id = uuid.UUID(resp.json()["id"])

        file_row = await db_session.get(File, file_id)
        assert file_row is not None
        assert file_row.owner_type == "agent_run"
        assert file_row.owner_id == worker_run.id

        logs = await _file_upload_logs(db_session, worker_run.id)
        assert len(logs) == 1
        assert logs[0].dedup_key == f"file-upload:{file_id}"

        # batch worker run 无会话：仅 run 通道 publish
        channels = [c.args[0] for c in mock_redis.publish.call_args_list]
        assert channels == [f"agent_run:{worker_run.id}"]

    async def test_post_run_id_not_found_404(self, artifact_client, auth_headers) -> None:
        """run_id 不存在 → 404。"""
        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers=auth_headers,
            files={"file": ("a.png", b"x", "image/png")},
            data={"run_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# 鉴权：越权 403 + 双路径（JWT / X-API-Key）
# ---------------------------------------------------------------------------


class TestUploadAuth:
    async def test_post_cross_workspace_403(self, artifact_client, db_session) -> None:
        """非 admin 用户只在别的工作区有写权限 → 锚 workspace 复核 403，无落库。"""
        from app.modules.auth.permissions import Permission

        decoy_ws = await _seed_workspace(db_session, name="诱饵工作区")
        target_ws = await _seed_workspace(db_session, name="目标工作区")
        outsider = await _make_user(db_session)
        await _grant_ws_permission(
            db_session,
            user=outsider,
            workspace_id=decoy_ws.id,
            permission=Permission.WORKSPACE_WRITE.value,
        )
        agent_session = await _seed_agent_session(db_session, target_ws.id)
        await _seed_run(db_session, agent_session_id=agent_session.id)

        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers={
                "Authorization": f"Bearer {_token_for(outsider)}",
                "X-Session-Id": str(agent_session.id),
            },
            **_png_form(),
        )
        assert resp.status_code == 403, resp.text
        assert _has_cjk(resp.json()["message"])
        files = (
            (await db_session.execute(select(File).where(File.owner_type == "agent_session")))
            .scalars()
            .all()
        )
        assert files == []

    async def test_post_workspace_less_session_by_owner_201(
        self, artifact_client, db_session
    ) -> None:
        """ql-20260823-013 核心场景：无工作区 runtime 会话，归属人（无任何 ws 角色）
        上传 → 201——不再按 workspace 锚兜底 deny。"""
        owner = await _make_user(db_session)
        agent_session = await _seed_agent_session(db_session, None, user_id=owner.id)
        active_run = await _seed_run(db_session, agent_session_id=agent_session.id)

        with patch("app.modules.agent.file_artifacts.get_redis", return_value=AsyncMock()):
            resp = await artifact_client.post(
                "/api/agent/file-artifacts",
                headers={
                    "Authorization": f"Bearer {_token_for(owner)}",
                    "X-Session-Id": str(agent_session.id),
                },
                **_png_form(description="无工作区会话产物"),
            )
        assert resp.status_code == 201, resp.text
        file_row = await db_session.get(File, uuid.UUID(resp.json()["id"]))
        assert file_row is not None
        assert file_row.owner_type == "agent_session"
        assert file_row.owner_id == agent_session.id
        assert file_row.uploaded_by == owner.id
        logs = await _file_upload_logs(db_session, active_run.id)
        assert len(logs) == 1

    async def test_post_workspace_less_session_by_non_owner_403(
        self, artifact_client, db_session
    ) -> None:
        """无工作区会话非归属人（连平台管理员也不是）→ 锚 NULL 兜底 deny 403。"""
        owner = await _make_user(db_session)
        agent_session = await _seed_agent_session(db_session, None, user_id=owner.id)
        await _seed_run(db_session, agent_session_id=agent_session.id)
        outsider = await _make_user(db_session)

        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers={
                "Authorization": f"Bearer {_token_for(outsider)}",
                "X-Session-Id": str(agent_session.id),
            },
            **_png_form(),
        )
        assert resp.status_code == 403, resp.text
        assert _has_cjk(resp.json()["message"])
        files = (
            (await db_session.execute(select(File).where(File.owner_type == "agent_session")))
            .scalars()
            .all()
        )
        assert files == []

    async def test_post_workspace_session_owner_without_ws_role_201(
        self, artifact_client, db_session
    ) -> None:
        """workspace 会话的归属人在该 ws 无任何角色 → 仍 201（脱钩工作区，
        ql-20260823-013；旧口径会在 require_permission_any 入口门 403）。"""
        ws = await _seed_workspace(db_session)
        owner = await _make_user(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id, user_id=owner.id)
        await _seed_run(db_session, agent_session_id=agent_session.id)

        with patch("app.modules.agent.file_artifacts.get_redis", return_value=AsyncMock()):
            resp = await artifact_client.post(
                "/api/agent/file-artifacts",
                headers={
                    "Authorization": f"Bearer {_token_for(owner)}",
                    "X-Session-Id": str(agent_session.id),
                },
                **_png_form(),
            )
        assert resp.status_code == 201, resp.text

    async def test_post_unauthenticated_401(self, artifact_client, db_session) -> None:
        """未携带任何凭证 → 401。"""
        ws = await _seed_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        await _seed_run(db_session, agent_session_id=agent_session.id)

        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers={"X-Session-Id": str(agent_session.id)},
            **_png_form(),
        )
        assert resp.status_code == 401, resp.text

    async def test_post_via_api_key_201(self, artifact_client, db_session) -> None:
        """X-API-Key 双路径（daemon apiKey → User）同样可达（mcp_tools 同款）。"""
        from app.core.config import get_settings
        from app.modules.auth.api_key_service import ApiKeyService

        admin = await _make_user(db_session, is_admin=True)
        _, plaintext = await ApiKeyService(db_session, settings=get_settings()).create(
            user_id=admin.id, name="daemon", expires_at=None
        )
        ws = await _seed_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        active_run = await _seed_run(db_session, agent_session_id=agent_session.id)

        with patch("app.modules.agent.file_artifacts.get_redis", return_value=AsyncMock()):
            resp = await artifact_client.post(
                "/api/agent/file-artifacts",
                headers={"X-API-Key": plaintext, "X-Session-Id": str(agent_session.id)},
                **_png_form(description="daemon 通道上传"),
            )
        assert resp.status_code == 201, resp.text
        logs = await _file_upload_logs(db_session, active_run.id)
        assert len(logs) == 1


# ---------------------------------------------------------------------------
# 重放与 publish 降级（R-05 / D-011@v1）
# ---------------------------------------------------------------------------


class TestReplayAndPublishDegrade:
    async def test_post_same_file_id_replay_no_500(
        self, artifact_client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """同 file_id 重放撞 dedup 唯一索引（SQLite 下部分索引 WHERE 被忽略、全列
        唯一）→ IntegrityError 视作已写入，201 不 500，日志行不重复。"""
        ws = await _seed_workspace(db_session)
        mission = await _seed_mission(db_session, ws.id)
        worker_run = await _seed_run(db_session, mission_id=mission.id)

        file_id = uuid.uuid4()
        # 先到者已写入同 (run_id, dedup_key) 日志行
        db_session.add(
            AgentRunLog(
                run_id=worker_run.id,
                timestamp=datetime.now(UTC),
                channel="tool_call",
                tool_kind="FileUpload",
                content_redacted=json.dumps({"file_id": str(file_id)}),
                dedup_key=f"file-upload:{file_id}",
            )
        )
        await db_session.commit()

        async def _fake_upload(self, **kwargs: Any) -> FileUploadResp:
            return FileUploadResp(
                id=file_id,
                original_name=kwargs["original_name"],
                mime_type=kwargs["mime_type"],
                size=len(kwargs["data"]),
                description=kwargs.get("description"),
            )

        monkeypatch.setattr(FileService, "upload_file", _fake_upload)

        resp = await artifact_client.post(
            "/api/agent/file-artifacts",
            headers=auth_headers,
            files={"file": ("重放.png", b"replay", "image/png")},
            data={"run_id": str(worker_run.id)},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["id"] == str(file_id)
        logs = await _file_upload_logs(db_session, worker_run.id)
        assert len(logs) == 1  # 先到者那一行，未重复落

    async def test_post_publish_failure_degrades(
        self, artifact_client, db_session, auth_headers
    ) -> None:
        """Redis publish 异常仅记 WARNING 降级——仍 201，日志行已持久化。"""
        ws = await _seed_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        active_run = await _seed_run(db_session, agent_session_id=agent_session.id)

        mock_redis = AsyncMock()
        mock_redis.publish = AsyncMock(side_effect=Exception("Redis connection lost"))
        with patch("app.modules.agent.file_artifacts.get_redis", return_value=mock_redis):
            resp = await artifact_client.post(
                "/api/agent/file-artifacts",
                headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
                **_png_form(),
            )
        assert resp.status_code == 201, resp.text
        assert mock_redis.publish.await_count >= 1
        logs = await _file_upload_logs(db_session, active_run.id)
        assert len(logs) == 1
        file_row = await db_session.get(File, uuid.UUID(resp.json()["id"]))
        assert file_row is not None


# ---------------------------------------------------------------------------
# GET 列表：倒序 + description/created_at + 读权限
# ---------------------------------------------------------------------------


async def _seed_file_row(
    session: AsyncSession,
    *,
    owner_type: str,
    owner_id: uuid.UUID,
    name: str,
    created_at: datetime,
    description: str | None = None,
) -> File:
    row = File(
        id=uuid.uuid4(),
        owner_type=owner_type,
        owner_id=owner_id,
        original_name=name,
        stored_key=f"2026/08/{uuid.uuid4()}.png",
        mime_type="image/png",
        size=10,
        uploaded_by=uuid.uuid4(),
        created_at=created_at,
        description=description,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


class TestListArtifacts:
    async def test_get_by_session_id_desc_order(
        self, artifact_client, db_session, auth_headers
    ) -> None:
        """按 session_id 列表：FileMetaResp 含 description/created_at，倒序。"""
        ws = await _seed_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        t1 = datetime(2026, 8, 23, 10, 0, tzinfo=UTC)
        t2 = datetime(2026, 8, 23, 11, 0, tzinfo=UTC)
        await _seed_file_row(
            db_session,
            owner_type="agent_session",
            owner_id=agent_session.id,
            name="旧文件.png",
            created_at=t1,
            description="第一份",
        )
        await _seed_file_row(
            db_session,
            owner_type="agent_session",
            owner_id=agent_session.id,
            name="新文件.png",
            created_at=t2,
            description="第二份",
        )
        # 其它归属行不串台
        await _seed_file_row(
            db_session,
            owner_type="workspace",
            owner_id=ws.id,
            name="无关文件.png",
            created_at=t2,
        )

        resp = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"session_id": str(agent_session.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        files = resp.json()["files"]
        assert [f["original_name"] for f in files] == ["新文件.png", "旧文件.png"]
        for f in files:
            assert f["description"] in ("第一份", "第二份")
            assert f["created_at"]

    async def test_get_by_run_id_desc_order(
        self, artifact_client, db_session, auth_headers
    ) -> None:
        """按 run_id 列表（owner_type=agent_run）倒序。"""
        ws = await _seed_workspace(db_session)
        mission = await _seed_mission(db_session, ws.id)
        run = await _seed_run(db_session, mission_id=mission.id, run_status="completed")
        await _seed_file_row(
            db_session,
            owner_type="agent_run",
            owner_id=run.id,
            name="早.png",
            created_at=datetime(2026, 8, 23, 9, 0, tzinfo=UTC),
            description=None,
        )
        await _seed_file_row(
            db_session,
            owner_type="agent_run",
            owner_id=run.id,
            name="晚.png",
            created_at=datetime(2026, 8, 23, 12, 0, tzinfo=UTC),
            description="后生成",
        )

        resp = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"run_id": str(run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        files = resp.json()["files"]
        assert [f["original_name"] for f in files] == ["晚.png", "早.png"]
        assert files[0]["description"] == "后生成"
        assert files[1]["description"] is None

    async def test_get_forbidden_without_read_403(self, artifact_client, db_session) -> None:
        """非 admin 只在别的工作区有读权限 → 锚复核 403（无 WORKSPACE_READ）。"""
        from app.modules.auth.permissions import Permission

        decoy_ws = await _seed_workspace(db_session, name="读诱饵工作区")
        target_ws = await _seed_workspace(db_session, name="读目标工作区")
        outsider = await _make_user(db_session)
        await _grant_ws_permission(
            db_session,
            user=outsider,
            workspace_id=decoy_ws.id,
            permission=Permission.WORKSPACE_READ.value,
        )
        agent_session = await _seed_agent_session(db_session, target_ws.id)

        resp = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"session_id": str(agent_session.id)},
            headers={"Authorization": f"Bearer {_token_for(outsider)}"},
        )
        assert resp.status_code == 403, resp.text

    async def test_get_workspace_less_session_by_owner_200(
        self, artifact_client, db_session
    ) -> None:
        """无工作区会话归属人列文件 → 200（ql-20260823-013 回显链路）。"""
        owner = await _make_user(db_session)
        agent_session = await _seed_agent_session(db_session, None, user_id=owner.id)
        await _seed_file_row(
            db_session,
            owner_type="agent_session",
            owner_id=agent_session.id,
            name="回显.png",
            created_at=datetime(2026, 8, 23, 12, 0, tzinfo=UTC),
        )

        resp = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"session_id": str(agent_session.id)},
            headers={"Authorization": f"Bearer {_token_for(owner)}"},
        )
        assert resp.status_code == 200, resp.text
        assert [f["original_name"] for f in resp.json()["files"]] == ["回显.png"]

    async def test_get_workspace_less_session_by_non_owner_403(
        self, artifact_client, db_session
    ) -> None:
        """无工作区会话非归属人列文件 → 403。"""
        owner = await _make_user(db_session)
        agent_session = await _seed_agent_session(db_session, None, user_id=owner.id)
        outsider = await _make_user(db_session)

        resp = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"session_id": str(agent_session.id)},
            headers={"Authorization": f"Bearer {_token_for(outsider)}"},
        )
        assert resp.status_code == 403, resp.text

    async def test_get_requires_exactly_one_param_422(self, artifact_client, auth_headers) -> None:
        """session_id 与 run_id 同给 / 均不给 → 422 中文。"""
        resp = await artifact_client.get("/api/agent/file-artifacts", headers=auth_headers)
        assert resp.status_code == 422, resp.text
        assert _has_cjk(resp.json()["message"])

        resp2 = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"session_id": str(uuid.uuid4()), "run_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp2.status_code == 422, resp2.text

    async def test_get_unknown_session_404(self, artifact_client, auth_headers) -> None:
        """session_id 不存在 → 404。"""
        resp = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"session_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text

    async def test_get_unknown_run_404(self, artifact_client, auth_headers) -> None:
        """run_id 不存在 → 404。"""
        resp = await artifact_client.get(
            "/api/agent/file-artifacts",
            params={"run_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
