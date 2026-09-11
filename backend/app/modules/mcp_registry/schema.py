"""Pydantic DTOs for the MCP central registry.

全套 DTO：创建/更新输入、列表/详情脱敏输出、binding 操作、导入（JSON 粘贴 /
workspace 扫描候选 / apply）、诊断、模板（design 文件变更清单 schema.py 行）。

密钥类型（ql-20260911-003-355a，用户裁决）：env 键是否加密由**用户逐键指定**
（``secret_env_keys`` 显式键名清单），不再按键名子串（token/key/secret/password）
自动判定。落库后的权威密钥键集 = ``encrypted_env`` 的键集；列表/详情输出
``secret_env_keys`` 供前端回显指定态，env 视图里密钥键**不出现**（值在密文列，
永不回明文）。键名子串规则仅存活于两处兜底：① workspace 扫描候选展示脱敏
（``McpWorkspaceCandidate``——原始文件无指定态，展示期遮蔽，apply 重读明文）；
② 导入路径的**缺省建议**（importer 侧物化为显式 ``secret_env_keys`` 落库，
用户可再编辑）。

编辑占位语义（P0-2 修复）：``McpServerUpdate`` 提交时，密钥键值等于
``<set>`` 占位符 = 保留既有密文不改（service 侧语义）；创建一律拒绝占位符。

encrypted_env 信封（Grill CC-03）：逐键独立密文 ``{SECRET_KEY: {"ct": <base64
密文>, "key_id": <版本标签>}}``——``McpEnvCiphertext.of`` 把 CredentialCipher.
encrypt(str)->tuple[bytes, key_id]（app/core/crypto.py:67-70）的返回值信封化；
key_id 为版本标签字符串（如 "v1"）非 uuid。本模块不 import crypto（加解密归
service/render，task-02/W2）。
"""

from __future__ import annotations

import base64
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# env 中含以下子串（大小写不敏感）的 key 视为 secret，输出遮蔽（沿用
# settings/router.py:160-193 的键名规则，保持加密侧/脱敏侧双向一致 R-05）。
_SECRET_KEY_MARKERS = ("token", "key", "secret", "password")
_SECRET_REDACTED_PLACEHOLDER = "<set>"

# mcpServers key 安全字符（design 数据模型节 name 注释）。
_NAME_PATTERN = r"^[a-z0-9][a-z0-9-]{1,99}$"

# 资产作用域：platform=平台共享库（写需 SETTINGS_ADMIN）/ mine=用户私有库。
# 与 list ?scope= 的 platform|mine|visible 词表对齐（visible 仅为查询态非落库态）。
Scope = Literal["platform", "mine"]


def redact_server_config_env(server_config: Any) -> Any:
    """返回 server_config 浅拷贝（env dict 重建），secret 键 value 遮蔽为 ``<set>``。

    非整数结构原样返回（防御）；顶层键与 env 中非 secret 键不动。
    """
    if not isinstance(server_config, dict):
        return server_config
    out = dict(server_config)
    env = out.get("env")
    if isinstance(env, dict):
        redacted: dict[str, Any] = {}
        for k, v in env.items():
            lowered = str(k).lower()
            if any(marker in lowered for marker in _SECRET_KEY_MARKERS):
                redacted[k] = _SECRET_REDACTED_PLACEHOLDER
            else:
                redacted[k] = v
        out["env"] = redacted
    return out


# ── encrypted_env 信封（Grill CC-03）─────────────────────────────────


class McpEnvCiphertext(BaseModel):
    """encrypted_env 单键密文信封：``{"ct": <base64 密文>, "key_id": <版本标签>}``。

    逐键独立加密（每键自带 key_id 支持密钥轮换）；解密时密钥失配抛
    CipherKeyMismatch → 诊断项 decrypt_failed，不炸渲染（design 数据模型节）。
    """

    ct: str  # base64(CredentialCipher.encrypt 返回的密文 bytes)
    key_id: str  # 密钥版本标签（如 "v1"，crypto.py:45-48；非 uuid）

    @classmethod
    def of(cls, ciphertext: bytes, key_id: str) -> McpEnvCiphertext:
        """CredentialCipher.encrypt 的 (密文 bytes, key_id) 返回值 → JSON 信封。"""
        return cls(ct=base64.b64encode(ciphertext).decode("ascii"), key_id=key_id)


# ── 创建 / 更新输入 ──────────────────────────────────────────────────


class McpServerCreate(BaseModel):
    """``POST /api/mcp-servers`` 请求体。

    ``secret_env_keys``：用户指定的密钥键名清单（ql-20260911-003-355a 用户自定义
    密钥类型）——清单内键值由 service 抽列加密进 encrypted_env，其余 env 键按
    明文留在 server_config；缺省 None=全部明文。清单键必须存在于 env（422），
    值一律不接受 ``<set>`` 占位符（创建无既有密文可保留）。scope=platform 需
    SETTINGS_ADMIN（router 层权限矩阵）。
    """

    name: str = Field(pattern=_NAME_PATTERN, max_length=100)
    server_config: dict[str, Any]
    secret_env_keys: list[str] | None = None
    scope: Scope = "mine"
    source: Literal["manual", "imported_json", "imported_workspace"] = "manual"
    dedup_key: str | None = Field(default=None, max_length=200)  # 'ws:<ws>:<name>'


class McpServerUpdate(BaseModel):
    """``PATCH /api/mcp-servers/{id}`` 请求体（None=不动该字段）。

    换 ``server_config`` 时：``secret_env_keys`` 同给则为其权威指定态；缺省则
    沿用既有密钥键集（与提交 env 的交集）。密钥键值 = ``<set>`` 占位符 = 保留
    既有密文（service 占位语义）；从密钥改明文的键必须提交新值（占位符 422）。
    只改 ``secret_env_keys``（不动 server_config）也支持：升级键值由明文加密，
    降级键解密回明文 env。
    """

    name: str | None = Field(default=None, pattern=_NAME_PATTERN, max_length=100)
    server_config: dict[str, Any] | None = None
    secret_env_keys: list[str] | None = None
    tags: list[str] | None = None
    note: str | None = None
    enabled: bool | None = None


class McpBindingCreate(BaseModel):
    """``POST /api/mcp-servers/{id}/bindings`` 请求体。

    platform 需 admin；user binding 校验 scope_ref=owner 或 server 为平台共享
    （service 层，design 接口定义）。
    """

    scope_type: Literal["platform", "user"]


# ── 列表 / 详情脱敏输出 ──────────────────────────────────────────────


class McpServerRead(BaseModel):
    """列表项（密钥键集回显 + 绑定态 + 诊断徽标，design REST 列表行）。

    ``secret_env_keys``：service 注入的密钥键名清单（= encrypted_env 键集）；
    ``server_config.env`` 只含明文键（密钥键不出现，值永不回明文）。
    绑定态/诊断徽标由 service 注入；缺省 False/空为安全方向（绝不虚报已绑定）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID | None
    name: str
    server_type: str
    server_config: dict[str, Any]
    secret_env_keys: list[str] = []
    tags: list[str]
    note: str
    enabled: bool
    source: str
    dedup_key: str | None
    created_at: datetime
    updated_at: datetime
    # service 注入（task-02）：当前用户视角的绑定态。
    platform_bound: bool = False
    user_bound: bool = False
    # service 注入（W2 诊断）：该 server 命中的诊断码（McpDiagnostic.code 子集）。
    diagnostic_codes: list[str] = []


class McpServerDetail(McpServerRead):
    """详情输出：额外带 encrypted_env 的脱敏形态（ct 遮蔽，key_id 保留）。"""

    encrypted_env: dict[str, dict[str, str]] | None = None

    @field_validator("encrypted_env", mode="before")
    @classmethod
    def _mask_ciphertext(cls, value: Any) -> Any:
        """每键 ct → 占位（密文不出后端），key_id 保留（版本信息非机密，供诊断展示）。"""
        if not isinstance(value, dict):
            return value
        masked: dict[str, dict[str, str]] = {}
        for k, v in value.items():
            if isinstance(v, dict):
                masked[str(k)] = {
                    "ct": _SECRET_REDACTED_PLACEHOLDER,
                    "key_id": str(v.get("key_id", "")),
                }
            else:
                masked[str(k)] = {"ct": _SECRET_REDACTED_PLACEHOLDER, "key_id": ""}
        return masked


class McpServerList(BaseModel):
    items: list[McpServerRead]
    total: int


# ── JSON 粘贴导入 ────────────────────────────────────────────────────


class McpImportRequest(BaseModel):
    """``POST /api/mcp-servers/import-json``：{json_text, scope}（task provides 契约）。"""

    json_text: str  # 三种包装由 importer 解析（task-03）
    scope: Scope = "mine"


class McpImportResult(BaseModel):
    """导入结果 {imported, skipped, renamed}（design REST 响应形状）。"""

    imported: list[str] = []  # 导入成功的 server 名
    skipped: list[str] = []  # 去重跳过的 server 名
    renamed: list[str] = []  # 归一化改名后的 server 名（原名见 importer detail）


# ── workspace 扫描导入 ───────────────────────────────────────────────


class McpWorkspaceScanRequest(BaseModel):
    """``POST /api/mcp-servers/workspace-scan``：workspace_id 缺省=扫描全部。"""

    workspace_id: uuid.UUID | None = None


class McpWorkspaceCandidate(BaseModel):
    """扫描候选（task provides 契约：name/server_config/workspace_id/dedup_verdict）。

    server_config 输出脱敏（apply 时 service 按 workspace_id+name 重读原文件取
    明文，脱敏展示不阻断应用）。
    """

    name: str
    server_config: dict[str, Any]
    workspace_id: uuid.UUID
    dedup_verdict: Literal["new", "duplicate", "renamed"]

    @field_validator("server_config", mode="before")
    @classmethod
    def _redact_env(cls, value: Any) -> Any:
        return redact_server_config_env(value)


class McpWorkspaceImportApplyRequest(BaseModel):
    """``POST /api/mcp-servers/workspace-import-apply``：{candidates, scope}。"""

    candidates: list[McpWorkspaceCandidate]
    scope: Scope = "mine"


# ── 模板 ────────────────────────────────────────────────────────────


class McpTemplateCreate(BaseModel):
    """``POST /api/mcp-servers/templates`` 双形态请求体（对齐 FetchModelsRequest 先例）。

    形态① ``from_server_id``：从既有 server 存为模板（service 只取明文 env，
    密钥键名随 ``secret_env_keys`` 保留——模板只记「哪些键要加密」不记值）；
    形态② ``server_config`` + ``secret_env_keys``：直接给配置与指定态。二者互斥
    （``_enforce_dual_form``）。
    """

    name: str = Field(pattern=_NAME_PATTERN, max_length=100)
    from_server_id: uuid.UUID | None = None
    server_config: dict[str, Any] | None = None
    secret_env_keys: list[str] = []

    @model_validator(mode="after")
    def _enforce_dual_form(self) -> McpTemplateCreate:
        if self.from_server_id is not None and self.server_config is not None:
            raise ValueError("存为模板：from_server_id 与 server_config 互斥（二选一）")
        if self.from_server_id is None and self.server_config is None:
            raise ValueError("存为模板：必须提供 from_server_id 或 server_config")
        return self


class McpTemplateRead(BaseModel):
    """模板列表项（明文 env 无密钥值 + ``secret_env_keys`` 指定态回显）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    server_config: dict[str, Any]
    secret_env_keys: list[str] = []
    is_preset: bool
    owner_user_id: uuid.UUID | None
    created_at: datetime


class McpTemplateList(BaseModel):
    items: list[McpTemplateRead]


# ── workspace 桥③导入视图（2026-09-11-workspace-asset-bridges D-004/D-009）──


class McpServerImportView(BaseModel):
    """``get_server_for_import`` 输出：导入构造期一次性明文形态。

    ``server_config.env`` 为解密后的完整明文 env——明文仅存在于导入内容构造
    期间（调用方写入 workspace ``.mcp.json`` 后即与手工编辑等价，D-004），本
    视图只经 service 内部调用链传递，绝不接 REST 展示端点。``warning``：
    enabled=false 或无 binding 时不阻断导入，仅提示「写入 .mcp.json 即生效、
    与平台启用/绑定状态无关」（D-009 三态）。
    """

    name: str
    server_config: dict[str, Any]
    enabled: bool
    has_binding: bool
    warning: str | None = None


# ── 诊断（render.precheck_diagnostics 输出，W2 消费）────────────────


class McpDiagnostic(BaseModel):
    """平台注入集预检单项（Grill B-03 五项重定义，design 接口定义）。"""

    code: Literal[
        "decrypt_failed",
        "bound_but_disabled",
        "platform_name_shadow",
        "workspace_blocked_by_whitelist",
        "invalid_type_defensive",
    ]
    server_id: uuid.UUID | None = None
    server_name: str | None = None
    detail: str | None = None  # 人读上下文（如 key_id 失配对 / 遮蔽的 workspace 名）
