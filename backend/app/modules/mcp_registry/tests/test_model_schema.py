"""mcp_registry 数据层单测：三表 ORM 契约 + DTO 脱敏 + encrypted_env 信封。

Change: 2026-09-10-mcp-central-registry（task-01）

覆盖（task implementation/acceptance 逐项）:
- 模型默认值：server_type=stdio / enabled=true / tags=[] / note='' / source=manual /
  dedup_key=None / encrypted_env=None，id 与时间戳自动填充（design 数据模型节）。
- 唯一性三条（ORM 与迁移双侧一致，本文件测 ORM 侧 + SQLite create_all 落地行为）:
  - ``uq_mcp_servers_owner_name``：COALESCE(owner_user_id, 全零 sentinel) + name
    函数唯一——平台位（owner NULL）同名互斥、跨 owner / owner vs 平台同名放行；
  - ``uq_binding_platform`` / ``uq_binding_user``：scope_type 条件 partial unique。
- DTO 脱敏：列表/详情/候选/模板的 server_config.env 中含 token/key/secret/password
  子串（大小写不敏感）的键 → ``<set>``（沿用 settings/router._SECRET_KEY_MARKERS）。
- encrypted_env 信封（Grill CC-03）：每键 ``{"ct": <base64>, "key_id": <版本标签>}``，
  缺任一字段校验拒绝；详情输出 ct 遮蔽为占位、key_id 保留。
"""

from __future__ import annotations

import base64
import uuid
from datetime import datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import Index
from sqlalchemy.exc import IntegrityError

from app.models.base import BaseModel
from app.modules.mcp_registry.model import McpServer, McpServerBinding, McpTemplate
from app.modules.mcp_registry.schema import (
    McpBindingCreate,
    McpDiagnostic,
    McpEnvCiphertext,
    McpImportRequest,
    McpImportResult,
    McpServerCreate,
    McpServerDetail,
    McpServerList,
    McpServerRead,
    McpServerUpdate,
    McpTemplateCreate,
    McpTemplateRead,
    McpWorkspaceCandidate,
    McpWorkspaceImportApplyRequest,
    McpWorkspaceScanRequest,
)

_CONFIG = {"command": "uvx", "args": ["mcp-server-fetch"], "env": {"CACHE_DIR": "/tmp"}}


# ── 模型：表注册与默认值 ──────────────────────────────────────────────


def test_tables_registered_in_metadata() -> None:
    """三表注册进 BaseModel.metadata（autogenerate / create_all 扫描前提）。"""
    for table_name in ("mcp_servers", "mcp_server_bindings", "mcp_templates"):
        assert table_name in BaseModel.metadata.tables


def test_mcp_server_defaults() -> None:
    """design 数据模型节逐项默认值（task-01 goal）。"""
    server = McpServer(name="fetch", server_config=dict(_CONFIG))
    assert isinstance(server.id, uuid.UUID)
    assert server.owner_user_id is None  # NULL=平台共享（D-001）
    assert server.server_type == "stdio"  # 建模预留枚举默认 stdio（D-005）
    assert server.enabled is True
    assert server.tags == []
    assert server.note == ""
    assert server.source == "manual"
    assert server.dedup_key is None
    assert server.encrypted_env is None
    assert isinstance(server.created_at, datetime)
    assert isinstance(server.updated_at, datetime)


def test_mcp_server_column_contract() -> None:
    """列长度/可空/FK 与 design 数据模型节逐字段一致。"""
    table = McpServer.__table__
    assert table.columns["name"].type.length == 100
    assert table.columns["server_type"].type.length == 10
    assert table.columns["source"].type.length == 30
    assert table.columns["dedup_key"].type.length == 200
    assert table.columns["owner_user_id"].nullable is True
    fks = list(table.columns["owner_user_id"].foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "users"
    assert fks[0].ondelete == "CASCADE"
    for col in ("name", "server_type", "server_config", "tags", "note", "enabled", "source"):
        assert table.columns[col].nullable is False, f"{col} must be NOT NULL"
    for col in ("encrypted_env", "dedup_key"):
        assert table.columns[col].nullable is True, f"{col} must be nullable"


def test_mcp_server_functional_unique_index() -> None:
    """uq_mcp_servers_owner_name：COALESCE(sentinel) + name 的函数唯一索引。"""
    indexes = {idx.name: idx for idx in McpServer.__table__.indexes}
    idx = indexes["uq_mcp_servers_owner_name"]
    assert isinstance(idx, Index)
    assert idx.unique is True
    rendered = str(idx.expressions[0])
    assert "COALESCE" in rendered.upper()
    assert "owner_user_id" in rendered
    assert "00000000-0000-0000-0000-000000000000" in rendered


def test_binding_partial_unique_indexes() -> None:
    """uq_binding_platform / uq_binding_user：scope_type 条件 partial unique。"""
    indexes = {idx.name: idx for idx in McpServerBinding.__table__.indexes}
    platform = indexes["uq_binding_platform"]
    user = indexes["uq_binding_user"]
    assert platform.unique is True
    assert user.unique is True
    # platform 位只按 server_id 唯一；user 位按 (server_id, scope_ref) 唯一。
    assert [col.name for col in platform.columns] == ["server_id"]
    assert [col.name for col in user.columns] == ["server_id", "scope_ref"]
    for idx, expected in ((platform, "platform"), (user, "user")):
        where = str(idx.dialect_options["postgresql"]["where"])
        assert "scope_type" in where and expected in where
        sqlite_where = str(idx.dialect_options["sqlite"]["where"])
        assert "scope_type" in sqlite_where


def test_binding_column_contract() -> None:
    """binding 表：server_id FK CASCADE / scope_type NOT NULL / scope_ref 可空。"""
    table = McpServerBinding.__table__
    fks = list(table.columns["server_id"].foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "mcp_servers"
    assert fks[0].ondelete == "CASCADE"
    assert table.columns["scope_type"].type.length == 10
    assert table.columns["scope_type"].nullable is False
    assert table.columns["scope_ref"].nullable is True
    binding = McpServerBinding(server_id=uuid.uuid4(), scope_type="platform")
    assert binding.scope_ref is None
    assert isinstance(binding.id, uuid.UUID)
    assert isinstance(binding.created_at, datetime)


def test_template_column_contract_and_defaults() -> None:
    """mcp_templates：name String(100) / server_config JSON / is_preset / owner 可空。"""
    table = McpTemplate.__table__
    assert table.columns["name"].type.length == 100
    for col in ("name", "server_config", "is_preset"):
        assert table.columns[col].nullable is False
    assert table.columns["owner_user_id"].nullable is True  # NULL=平台预置 seed
    template = McpTemplate(name="fetch", server_config=dict(_CONFIG))
    assert template.is_preset is False
    assert template.owner_user_id is None
    assert isinstance(template.id, uuid.UUID)
    assert isinstance(template.created_at, datetime)


# ── 唯一性落地（SQLite 内存库 create_all + 插入冲突）──────────────────


@pytest.mark.asyncio
async def test_owner_name_unique_platform_scope(db_session) -> None:
    """平台位（owner NULL）同名两条 → IntegrityError（sentinel 归一唯一）。"""
    db_session.add(McpServer(name="dup", server_config=dict(_CONFIG)))
    await db_session.commit()
    db_session.add(McpServer(name="dup", server_config=dict(_CONFIG)))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_owner_name_same_name_different_owners_allowed(db_session) -> None:
    """不同 owner 同名放行 + owner 与平台位同名放行（sentinel ≠ 具体 uuid）。"""
    a, b = uuid.uuid4(), uuid.uuid4()
    db_session.add(McpServer(name="shared", owner_user_id=a, server_config=dict(_CONFIG)))
    db_session.add(McpServer(name="shared", owner_user_id=b, server_config=dict(_CONFIG)))
    db_session.add(McpServer(name="shared", server_config=dict(_CONFIG)))
    await db_session.commit()  # 不抛即通过


@pytest.mark.asyncio
async def test_binding_platform_partial_unique(db_session) -> None:
    """同 server 两条 platform binding 冲突；user binding 不受 platform 位约束。"""
    server = McpServer(name="srv-plat", server_config=dict(_CONFIG))
    db_session.add(server)
    await db_session.commit()
    server_id = server.id  # rollback 会 expire 实例，先取 id
    db_session.add(McpServerBinding(server_id=server_id, scope_type="platform"))
    await db_session.commit()
    db_session.add(McpServerBinding(server_id=server_id, scope_type="platform"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    # platform 位与 user 位互不约束（partial index 各管各的 WHERE 分支）。
    db_session.add(McpServerBinding(server_id=server_id, scope_type="user", scope_ref=uuid.uuid4()))
    await db_session.commit()


@pytest.mark.asyncio
async def test_binding_user_partial_unique(db_session) -> None:
    """同 server 同 scope_ref 的两条 user binding 冲突；不同 scope_ref 放行。"""
    server = McpServer(name="srv-user", server_config=dict(_CONFIG))
    db_session.add(server)
    await db_session.commit()
    server_id = server.id  # rollback 会 expire 实例，先取 id
    ref = uuid.uuid4()
    db_session.add(McpServerBinding(server_id=server_id, scope_type="user", scope_ref=ref))
    await db_session.commit()
    db_session.add(McpServerBinding(server_id=server_id, scope_type="user", scope_ref=ref))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    db_session.add(McpServerBinding(server_id=server_id, scope_type="user", scope_ref=uuid.uuid4()))
    await db_session.commit()


# ── DTO：创建/更新输入 ────────────────────────────────────────────────


def test_create_defaults_and_name_pattern() -> None:
    """scope/source 默认 manual+mine；name 字符集 ^[a-z0-9][a-z0-9-]{1,99}$。"""
    inp = McpServerCreate(name="fetch-backup", server_config=dict(_CONFIG))
    assert inp.scope == "mine"
    assert inp.source == "manual"
    assert inp.dedup_key is None
    for bad_name in ("Bad_Name", "-lead", "x", "a" * 101, "有名字"):
        with pytest.raises(ValidationError):
            McpServerCreate(name=bad_name, server_config=dict(_CONFIG))


def test_update_dto_all_optional() -> None:
    """Update 全字段可空（None=不动）。"""
    inp = McpServerUpdate()
    assert inp.name is None
    assert inp.server_config is None
    assert inp.tags is None
    assert inp.note is None
    assert inp.enabled is None
    inp2 = McpServerUpdate(name="renamed-2", tags=["a", "b"], enabled=False)
    assert inp2.name == "renamed-2"
    assert inp2.tags == ["a", "b"]
    assert inp2.enabled is False


def test_binding_create_scope_type_literal() -> None:
    assert McpBindingCreate(scope_type="platform").scope_type == "platform"
    with pytest.raises(ValidationError):
        McpBindingCreate(scope_type="workspace")


# ── DTO：列表/详情脱敏（_SECRET_KEY_MARKERS 四标记子串规则）──────────


def _config_with_secrets() -> dict:
    return {
        "command": "npx",
        "args": ["-y", "server"],
        "env": {
            "GITHUB_TOKEN": "ghp_secret",  # token
            "API_KEY": "k",  # key
            "DB_SECRET": "s",  # secret
            "MYSQL_PASSWORD": "p",  # password（大小写不敏感）
            "CACHE_DIR": "/tmp",  # 非 secret 原样
            "COUNT": "1",  # 非 secret 原样
        },
    }


def _now() -> datetime:
    from datetime import UTC

    return datetime.now(UTC)


def test_read_redacts_secret_env_keys() -> None:
    """列表 DTO：secret 键 → <set>，非 secret 键与其它顶层键原样。"""
    cfg = _config_with_secrets()
    read = McpServerRead(
        id=uuid.uuid4(),
        owner_user_id=None,
        name="srv",
        server_type="stdio",
        server_config=cfg,
        tags=["t"],
        note="",
        enabled=True,
        source="manual",
        dedup_key=None,
        created_at=_now(),
        updated_at=_now(),
    )
    env = read.server_config["env"]
    for secret_key in ("GITHUB_TOKEN", "API_KEY", "DB_SECRET", "MYSQL_PASSWORD"):
        assert env[secret_key] == "<set>", f"{secret_key} 应被脱敏"
    assert env["CACHE_DIR"] == "/tmp"
    assert env["COUNT"] == "1"
    assert read.server_config["command"] == "npx"
    # 原始 dict 不被原地改写（调用方数据不被 DTO 构造污染）。
    assert cfg["env"]["GITHUB_TOKEN"] == "ghp_secret"
    # service 注入字段缺省安全方向。
    assert read.platform_bound is False
    assert read.user_bound is False
    assert read.diagnostic_codes == []


def test_read_from_attributes_with_orm_object() -> None:
    """from_attributes 直接吃 ORM 行也走脱敏（安全由构造保证）。"""
    server = McpServer(name="srv2", server_config=_config_with_secrets(), tags=["x"])
    read = McpServerRead.model_validate(server)
    assert read.server_config["env"]["API_KEY"] == "<set>"
    assert read.name == "srv2"


def test_detail_masks_encrypted_env_ciphertext() -> None:
    """详情 DTO：encrypted_env 每键 ct 遮蔽为 <set>，key_id 保留（版本信息非机密）。"""
    detail = McpServerDetail(
        id=uuid.uuid4(),
        owner_user_id=None,
        name="srv3",
        server_type="stdio",
        server_config=dict(_CONFIG),
        tags=[],
        note="",
        enabled=True,
        source="manual",
        dedup_key=None,
        created_at=_now(),
        updated_at=_now(),
        encrypted_env={"API_KEY": {"ct": "AAECAw==", "key_id": "v1"}},
    )
    assert detail.encrypted_env is not None
    assert detail.encrypted_env["API_KEY"]["ct"] == "<set>"
    assert detail.encrypted_env["API_KEY"]["key_id"] == "v1"


def test_list_dto_shape() -> None:
    item = McpServerRead(
        id=uuid.uuid4(),
        owner_user_id=None,
        name="srv4",
        server_type="stdio",
        server_config=dict(_CONFIG),
        tags=[],
        note="",
        enabled=True,
        source="manual",
        dedup_key=None,
        created_at=_now(),
        updated_at=_now(),
    )
    listing = McpServerList(items=[item], total=1)
    assert listing.total == 1
    assert listing.items[0].name == "srv4"


# ── encrypted_env 信封（Grill CC-03）─────────────────────────────────


def test_env_ciphertext_envelope_structure() -> None:
    """信封 = {ct: base64 密文, key_id: 版本标签}；缺一不可。"""
    ct_bytes = b"\x01\x02\x03\x04"
    envelope = McpEnvCiphertext.of(ct_bytes, "v1")
    assert envelope.ct == base64.b64encode(ct_bytes).decode("ascii")
    assert envelope.key_id == "v1"
    parsed = McpEnvCiphertext.model_validate({"ct": envelope.ct, "key_id": "v1"})
    assert parsed == envelope
    with pytest.raises(ValidationError):
        McpEnvCiphertext.model_validate({"ct": envelope.ct})  # 缺 key_id
    with pytest.raises(ValidationError):
        McpEnvCiphertext.model_validate({"key_id": "v1"})  # 缺 ct


# ── 导入 / 扫描候选 / 模板 / 诊断 DTO ────────────────────────────────


def test_import_request_contract() -> None:
    req = McpImportRequest(json_text='{"mcpServers": {}}')
    assert req.scope == "mine"
    with pytest.raises(ValidationError):
        McpImportRequest(json_text="", scope="visible")  # scope 字面量限 platform|mine


def test_import_result_shape() -> None:
    result = McpImportResult(imported=["a"], skipped=["b"], renamed=["c"])
    assert result.imported == ["a"]
    assert result.skipped == ["b"]
    assert result.renamed == ["c"]
    assert McpImportResult().imported == []


def test_workspace_scan_and_candidate_contract() -> None:
    """候选：name/server_config/workspace_id/dedup_verdict 四字段 + env 脱敏。"""
    scan = McpWorkspaceScanRequest()
    assert scan.workspace_id is None  # None=扫描全部 workspace
    wid = uuid.uuid4()
    candidate = McpWorkspaceCandidate(
        name="ws-srv",
        server_config=_config_with_secrets(),
        workspace_id=wid,
        dedup_verdict="new",
    )
    assert candidate.workspace_id == wid
    assert candidate.server_config["env"]["GITHUB_TOKEN"] == "<set>"
    with pytest.raises(ValidationError):
        McpWorkspaceCandidate(
            name="ws-srv",
            server_config=dict(_CONFIG),
            workspace_id=wid,
            dedup_verdict="conflict",  # 非法判定值
        )
    apply_req = McpWorkspaceImportApplyRequest(candidates=[candidate], scope="platform")
    assert apply_req.scope == "platform"
    assert apply_req.candidates[0].name == "ws-srv"


def test_template_create_dual_form() -> None:
    """from_server_id 与 server_config 二选一（对齐 FetchModelsRequest 先例）。"""
    sid = uuid.uuid4()
    assert McpTemplateCreate(name="tpl-a", from_server_id=sid).from_server_id == sid
    assert McpTemplateCreate(name="tpl-b", server_config=dict(_CONFIG)).server_config is not None
    with pytest.raises(ValidationError):  # 同时给
        McpTemplateCreate(name="tpl-c", from_server_id=sid, server_config=dict(_CONFIG))
    with pytest.raises(ValidationError):  # 都不给
        McpTemplateCreate(name="tpl-d")


def test_template_read_redacts_env() -> None:
    """模板 server_config 明文本无 secret，输出仍走脱敏兜底（防御纵深）。"""
    read = McpTemplateRead(
        id=uuid.uuid4(),
        name="tpl",
        server_config=_config_with_secrets(),
        is_preset=True,
        owner_user_id=None,
        created_at=_now(),
    )
    assert read.is_preset is True
    assert read.server_config["env"]["DB_SECRET"] == "<set>"


def test_diagnostic_code_literal() -> None:
    """诊断码限定 design 接口定义五项。"""
    diag = McpDiagnostic(code="decrypt_failed", server_name="srv", detail="key mismatch")
    assert diag.server_id is None
    for code in (
        "decrypt_failed",
        "bound_but_disabled",
        "platform_name_shadow",
        "workspace_blocked_by_whitelist",
        "invalid_type_defensive",
    ):
        assert McpDiagnostic(code=code).code == code
    with pytest.raises(ValidationError):
        McpDiagnostic(code="will_be_rejected_by_whitelist")  # Grill B-03 已废弃命名
