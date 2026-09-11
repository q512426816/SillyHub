"""MCP 中央资产库三表 ORM：McpServer / McpServerBinding / McpTemplate。

Change: 2026-09-10-mcp-central-registry（task-01 / design「数据模型」节——三表字段
的唯一权威，逐字段对照无发明）。Column 风光照 ``app/modules/llm_provider/model.py``
（SQLModel Field + sa_column），时间戳照 ``app/modules/mcp_gateway/model.py``
（DateTime(timezone=True) + server_default now()）。

本 task 只落 schema（表 + ORM），service/router/render/importer 归后续 task：
- ``mcp_servers``：MCP server 定义一等实体。``owner_user_id`` NULL=平台共享库
  （D-001 双层可见性）；``server_config`` 明文配置（env 仅非 secret 键，secret 键
  由 service 抽列进 ``encrypted_env``）；``encrypted_env`` 逐键密文信封
  ``{SECRET_KEY: {"ct": "<base64 密文>", "key_id": "<版本标签>"}}``（Grill CC-03，
  CredentialCipher.encrypt(str)->tuple[bytes, key_id] 循环调用，信封化在 schema.py）；
  ``server_type`` 建模预留 'stdio'|'http'|'sse'，写路径仅 stdio 的校验属 task-02
  （D-005）；``dedup_key`` 'ws:<workspace_id>:<name>' 扫描导入去重锚。
- ``mcp_server_bindings``：启用绑定（D-002 独立表）。UNIQUE(server_id, scope_type,
  scope_ref) 拆两条 partial unique index（PG 原生，sqlite_where 供测试侧 create_all
  等价语义，agent/model.py:1413 先例）；「user binding 时 scope_ref 必须 = owner 或
  server 为平台共享」业务约束在 service 层。
- ``mcp_templates``：收藏模板（预置 seed + 自存）。``server_config`` 明文无 secret；
  ``owner_user_id`` NULL=平台预置（design 未声明 FK，按字面不建外键）。

列定义须与 ``migrations/versions/20260910140000_add_mcp_registry_tables.py``
一一对应（防漂移）；新表 NOT NULL 非时间戳列不设 server_default（默认在 ORM
Python 侧，20260829010000 / 20260902010000 先例）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel

# COALESCE sentinel：owner_user_id 为 NULL（平台共享）时归一到全零 uuid，让
# (owner 维度, name) 函数唯一索引对平台位生效（PG NULL 不参与唯一约束）。
# 不写 '...'::uuid 显式转换——SQLite 测试侧 create_all 不识别 PG cast，而 PG 对
# 未知类型字面量在 COALESCE 上下文隐式收敛为 uuid（双方言同语义，与迁移侧逐字一致）。
_OWNER_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000"


def _utcnow() -> datetime:
    return datetime.now(UTC)


class McpServer(BaseModel, table=True):
    """MCP server 定义（平台共享库 owner=NULL / 用户私有库 owner=user，D-001）。"""

    __tablename__ = "mcp_servers"
    __table_args__ = (
        # 函数唯一索引：COALESCE(owner_user_id, 全零 sentinel) + name——平台位同名
        # 互斥、跨 owner / owner vs 平台同名放行（design 数据模型节唯一性规格）。
        Index(
            "uq_mcp_servers_owner_name",
            text(f"COALESCE(owner_user_id, '{_OWNER_SENTINEL_UUID}')"),
            "name",
            unique=True,
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # NULL=平台共享（admin 管理、全员可见）；user=私有库（个人 token 不外泄）。
    owner_user_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # mcpServers key 安全字符 ^[a-z0-9][a-z0-9-]{1,99}$ 的字符集校验在 schema 层，
    # DB 只保证长度上限（skills name 先例）。
    name: str = Field(
        max_length=100,
        sa_column=Column(String(100), nullable=False),
    )
    # 'stdio'|'http'|'sse' 建模预留，默认 stdio；写路径仅 stdio 校验属 task-02（D-005）。
    server_type: str = Field(
        default="stdio",
        max_length=10,
        sa_column=Column(String(10), nullable=False),
    )
    # {command, args, env}；env 仅含明文键（密键由用户显式指定、service 抽列加密，
    # ql-20260911-003-355a 用户自定义密钥类型）。
    server_config: dict[str, Any] = Field(
        sa_column=Column(JSON, nullable=False),
    )
    # 密钥键的密文映射（Grill CC-03 信封；键集=用户指定的 secret_env_keys）：
    #   {SECRET_KEY: {"ct": "<base64(密文 bytes)>", "key_id": "<版本标签，如 v1>"}}
    # 逐键独立加密（每键自带 key_id 支持密钥轮换）；解密失配 → 诊断项 decrypt_failed。
    encrypted_env: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    note: str = Field(
        default="",
        sa_column=Column(Text, nullable=False),
    )
    enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False),
    )
    # 'manual'|'imported_json'|'imported_workspace'。
    source: str = Field(
        default="manual",
        max_length=30,
        sa_column=Column(String(30), nullable=False),
    )
    # 'ws:<workspace_id>:<name>'——扫描导入去重锚（保留原名可追溯，R-07）。
    dedup_key: str | None = Field(
        default=None,
        max_length=200,
        sa_column=Column(String(200), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=_utcnow,
        ),
    )


class McpServerBinding(BaseModel, table=True):
    """server 的启用绑定：注入集 = platform binding 全集 ∪ 该用户 user binding（D-002）。

    scope_type='platform' 时 scope_ref 恒 NULL（平台位单行，partial unique 按
    server_id 唯一）；'user' 时 scope_ref=user_id（partial unique 按 (server_id,
    scope_ref) 唯一）。user binding 的 scope_ref 必须 = server.owner_user_id 或
    server 为平台共享（owner NULL）——业务约束在 service 层，DB 只保证行唯一。
    """

    __tablename__ = "mcp_server_bindings"
    __table_args__ = (
        # UNIQUE(server_id, scope_type, scope_ref) 拆两条 partial unique index
        # （design 数据模型节；postgresql_where 供 PG、sqlite_where 供测试侧
        # create_all，双方言同语义，agent/model.py:1413-1420 先例）。
        Index(
            "uq_binding_platform",
            "server_id",
            unique=True,
            postgresql_where=text("scope_type = 'platform'"),
            sqlite_where=text("scope_type = 'platform'"),
        ),
        Index(
            "uq_binding_user",
            "server_id",
            "scope_ref",
            unique=True,
            postgresql_where=text("scope_type = 'user'"),
            sqlite_where=text("scope_type = 'user'"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # server 删则级联删 binding（design：delete_server 级联 binding）。
    server_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("mcp_servers.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # 'platform' | 'user'。
    scope_type: str = Field(
        max_length=10,
        sa_column=Column(String(10), nullable=False),
    )
    # platform=NULL；user=user_id。
    scope_ref: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class McpTemplate(BaseModel, table=True):
    """收藏模板：平台预置 seed（owner NULL + is_preset）+ 用户自存（design W3）。"""

    __tablename__ = "mcp_templates"
    __table_args__ = (
        # 预置位 name 唯一（P2-11：并发首调双 seed 的 check-then-insert 竞态由本
        # 索引拒绝；自存模板不限名——跨用户同名 + 本人改名复用均合法）。
        Index(
            "uq_mcp_templates_preset_name",
            "name",
            unique=True,
            postgresql_where=text("is_preset"),
            sqlite_where=text("is_preset"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    name: str = Field(
        max_length=100,
        sa_column=Column(String(100), nullable=False),
    )
    # 明文模板（密钥值不进模板——只随 secret_env_keys 记键名）。
    server_config: dict[str, Any] = Field(
        sa_column=Column(JSON, nullable=False),
    )
    # 密钥键名清单（ql-20260911-003-355a 用户自定义密钥类型）：「从模板新建」
    # 预勾加密开关的依据；值由用户在表单里补。
    secret_env_keys: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    is_preset: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False),
    )
    # NULL=平台预置 seed；design 数据模型节未声明 FK，按字面建裸 UUID 列。
    owner_user_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
