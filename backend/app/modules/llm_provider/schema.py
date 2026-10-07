"""Pydantic DTOs for LLM provider.

api_key 仅以 masked 形式出参（``api_key_masked``），明文 / 密文永不暴露（R-02/R-04）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProviderModelEntry(BaseModel):
    """模型条目（change 2026-10-06-provider-model-list / D-001/D-002）。

    一条模型的自包含配置：多模态三态（auto=按模型名启发式，D-03）+ 可选 Claude
    角色标记（可多标，同角色多条时注入取首条）+ one_m（1M 上下文勾选，daemon
    消费面拼 [1m] 后缀语义不变）。
    """

    name: str = Field(min_length=1)
    multimodal: Literal["auto", "true", "false"] = "auto"
    roles: list[Literal["sonnet", "opus", "fable", "haiku"]] = Field(default=[])
    one_m: bool = False

    @field_validator("roles")
    @classmethod
    def _dedupe_roles(cls, v: list[str]) -> list[str]:
        """保序去重（重复角色归一）。"""
        return list(dict.fromkeys(v))

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("模型名不能为空白")
        return v


class LlmProviderCreate(BaseModel):
    name: str
    # task-04（2026-09-10-review-dispatch-platform-fixes / D-002@v1）：放开 pi——
    # 平台 worker 走独立配额池凭证（daemon 侧 PiCredentialInjector 消费）。
    # task-05（2026-09-10-multi-provider-injection / FR-04）：词表增 codex——
    # codex 不走 env 注入器，凭证经 daemon 文件层（会话隔离 CODEX_HOME，D-012）注入。
    # change 2026-10-06-provider-multi-agent-kind（D-004）：单值改引擎集合——一条凭证
    # 可服务多个引擎，至少一个（min_length=1，无默认值，必须显式传）；保序去重
    # （["claude","claude"] 归一为 ["claude"]，validator 见下）。
    agent_kinds: list[Literal["claude", "pi", "codex"]] = Field(min_length=1)
    models: list[ProviderModelEntry] = []
    base_url: str | None = None
    api_key: str | None = None
    notes: str | None = None
    website_url: str | None = None
    # task-04（2026-09-10-review-dispatch-platform-fixes / D-002@v1）：auth_field 由
    # 双字面量泛化为 env 变量名形状（大写字母开头，仅大写/数字/下划线）——pi 凭证行
    # 用独立配额池 env 名（如 ZAI_API_KEY / OPENROUTER_API_KEY）；claude 旧双字面量
    # 天然命中本 pattern，缺省值不变（零回归）。
    auth_field: str = Field(default="ANTHROPIC_AUTH_TOKEN", pattern=r"^[A-Z][A-Z0-9_]*$")
    api_format: Literal["anthropic", "openai_chat"] = "anthropic"
    extra_env: dict[str, Any] | None = None
    settings_config: dict[str, Any] | None = None
    is_default: bool = False

    @field_validator("agent_kinds")
    @classmethod
    def _dedupe_agent_kinds(cls, v: list[str]) -> list[str]:
        """保序去重（D-004）：重复引擎归一；去重后空表由 min_length 拦。"""
        return list(dict.fromkeys(v))

    @model_validator(mode="after")
    def _forbid_pi_openai_chat(self) -> LlmProviderCreate:
        """pi × openai_chat 禁配——集合级判定（task-05 / FR-04 / D-012；D-005 升级）。

        该组合两层注入均不生效：pi env 层不带端点（不读 BASE_URL）、文件层
        models.json 仅 anthropic 形态直连，openai_chat 通道对 pi 无消费方。
        Create 侧在此 422（ValidationError 自然冒泡，勾集含 pi 即拒）；Update 侧
        agent_kinds 可选（None=不动），组合校验落 service 层取行合并后判
        （Plan 约束 2，双口径同语义）。
        codex/claude × openai_chat 不受限（codex 走 litellm_proxy 通道，D-006）。
        """
        if "pi" in self.agent_kinds and self.api_format == "openai_chat":
            raise ValueError(
                "pi 供应商不支持 openai_chat API 格式（两层注入均不生效），"
                "请改用 anthropic 格式或选择 codex/claude 供应商"
            )
        return self


class LlmProviderUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None  # None = 不动原密钥
    notes: str | None = None
    website_url: str | None = None
    # task-04（2026-09-10-review-dispatch-platform-fixes）：与 Create 同款 env 名
    # pattern（见 Create.auth_field 注释）；None=不动原值语义不变。
    auth_field: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]*$")
    api_format: Literal["anthropic", "openai_chat"] | None = None
    # 引擎集合可编辑（D-004/D-006）：None=不动；非 None 时至少一个 + 保序去重
    # （validator 见下，与 Create 同口径）。
    agent_kinds: list[Literal["claude", "pi", "codex"]] | None = Field(default=None, min_length=1)
    # 模型列表（D-001）：None=不动；非 None 时整表替换（条目级编辑在前端完成）。
    models: list[ProviderModelEntry] | None = None
    extra_env: dict[str, Any] | None = None
    settings_config: dict[str, Any] | None = None
    is_default: bool | None = None

    @field_validator("agent_kinds")
    @classmethod
    def _dedupe_agent_kinds(cls, v: list[str] | None) -> list[str] | None:
        """保序去重（D-004，与 Create 同口径）；None=不动语义透传。"""
        if v is None:
            return None
        return list(dict.fromkeys(v))


class LlmProviderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    agent_kinds: list[str]
    models: list[ProviderModelEntry]
    base_url: str | None
    notes: str | None
    website_url: str | None
    auth_field: str
    api_format: str
    extra_env: dict[str, Any] | None
    settings_config: dict[str, Any] | None = None
    is_default: bool
    # service _to_read 算后注入（默认 None = 安全方向，绝不泄漏明文，规则 X-09）
    api_key_masked: str | None = None
    # 多模态三态已下沉到模型条目（ProviderModelEntry.multimodal，D-003）；
    # 供应商级字段退役（2026-10-06-provider-model-list）。
    created_at: datetime
    updated_at: datetime


class LlmProviderList(BaseModel):
    items: list[LlmProviderRead]
    total: int


# ── fetch-models（task-02 / D-001/D-006）─────────────────────────────────────
# 独立段落：本块只加 fetch-models 相关新 schema，不动既有 LlmProvider* 块（task-01 负责
# settings_config）。双形态联合：``provider_id``（编辑态后端解密）或 ``base_url+api_key``
# （新建态用完即弃，NFR-02）。


class FetchModelsRequest(BaseModel):
    """``POST /api/llm-providers/fetch-models`` 双形态请求体（D-001）。

    形态① 编辑态：``provider_id`` → service 查行 + ``cipher.decrypt`` 取明文 key +
    auth_field + base_url（前端只传 id，明文 key 不出后端）。
    形态② 新建态：``base_url`` + ``api_key``（+可选 ``auth_field``）→ 直传不落库不入日志，
    用完即弃（NFR-02）。

    二者互斥（``_enforce_dual_form`` 保证），不能同时填也不能都不填。
    """

    provider_id: uuid.UUID | None = None
    base_url: str | None = None
    api_key: str | None = None  # 仅新建态；明文永不落库（NFR-02）
    # task-04（2026-09-10-review-dispatch-platform-fixes）：与 Create 同款 env 名
    # pattern（见 Create.auth_field 注释）；None=缺省语义不变（编辑态从行读）。
    auth_field: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]*$")
    # API 格式（task-02 / FR-01/FR-03）：编辑态从 provider 行读，新建态从请求体读；
    # 缺省 anthropic（NFR-02 零回归）。openai_chat 时 service 忽略 auth_field（D-002@v1）。
    api_format: Literal["anthropic", "openai_chat"] | None = None

    @model_validator(mode="after")
    def _enforce_dual_form(self) -> FetchModelsRequest:
        has_provider = self.provider_id is not None
        has_inline_url = self.base_url is not None
        has_inline_key = self.api_key is not None
        # 互斥：provider_id 与 base_url/api_key 不能同时出现
        if has_provider and (has_inline_url or has_inline_key or self.auth_field is not None):
            raise ValueError(
                "fetch-models: provider_id 与 base_url/api_key/auth_field 互斥（二选一）"
            )
        # 完整性：无 provider_id 时必须同时给 base_url + api_key
        if not has_provider and not (has_inline_url and has_inline_key):
            raise ValueError("fetch-models: 必须提供 provider_id 或 (base_url + api_key)")
        return self


class FetchModelsItem(BaseModel):
    """上游 /v1/models 返回的单条模型（OpenAI 兼容字段；owned_by 上游缺失则 None）。"""

    id: str
    owned_by: str | None = None


class FetchModelsResponse(BaseModel):
    """fetch-models 响应：模型列表（明文 key 永不进响应，NFR-02）。"""

    models: list[FetchModelsItem]


# ── usage 查询（task-01 / D-005）──────────────────────────────────────────────
# 对齐 cc-switch ``provider.rs:283-315`` snake_case 契约（balance 回绝对额 / token_plan
# 回百分比，统一进 UsageData；多窗口 tier 走 UsageResult.data 数组）。明文 key 永不进
# 该结构（NFR-02），故无任何 api_key 字段。


class UsageData(BaseModel):
    """单条用量（一个套餐窗口 = 一条；多窗口 5h/周/月各自一条 tier）。

    - ``plan_name``：套餐名 / 币种 / 窗口名（如「CNY」「5小时窗」「周限额」）；
    - ``extra``：附加信息（token_plan 的重置时间 ISO8601 等）；
    - ``is_valid``：凭据是否有效，``False`` → 前端翻红；
    - ``invalid_message``：失效原因（鉴权失败等）；
    - ``total/used/remaining``：balance=金额（CNY/USD）；token_plan=百分比（total=100）；
    - ``unit``：``"USD"`` / ``"CNY"`` / ``"%"``。
    """

    plan_name: str | None = None
    extra: str | None = None
    is_valid: bool | None = None
    invalid_message: str | None = None
    total: float | None = None
    used: float | None = None
    remaining: float | None = None
    unit: str | None = None


class UsageResult(BaseModel):
    """用量查询统一返回（D-005 错误两态）。

    - ``success=True`` + ``data``：多 tier 余额/额度；
    - ``success=False`` + ``data=[{is_valid:False}]``：确定性鉴权失败（前端翻红）；
    - ``success=False`` + ``error``：其它确定性失败（不支持 / 解析错 / SSRF，前端灰提示）；
    - 瞬时失败（网络/5xx/429/超时）在 service 层 ``raise``（5xx），不走到本结构。
    """

    success: bool
    data: list[UsageData] | None = None
    error: str | None = None


# ── quota 查询（sessions-portal task-07 / FR-08 / D-009@v1）───────────────────
# 弱依赖（R-05）：仅 GLM 一期返回窗口数据；其余供应商 / 上游失败 / 无数据一律
# ``quota=None``（HTTP 200），前端 null 不显示胶囊。明文 key 永不进该结构（NFR-02）。


class LlmProviderQuotaWindow(BaseModel):
    """单个额度窗口（5 小时窗 / 周限额）。

    - ``label``：窗口名（沿用智谱 tier ``plan_name``，含套餐等级前缀如「Max·5小时窗」）；
    - ``left``：剩余百分比（0-100，口径同 ``UsageData.remaining``）；
    - ``reset``：重置时间 ISO8601（上游缺失则 None）。
    """

    label: str | None = None
    left: float | None = None
    reset: str | None = None


class LlmProviderQuotaData(BaseModel):
    """quota 非 null 载荷（design §7.1）：``{model, windows[]}``。"""

    # 主模型名回显（router 层由 models 列表派生传入，usage_handlers 契约键）。
    model: str | None = None
    windows: list[LlmProviderQuotaWindow] = []


class LlmProviderQuotaResponse(BaseModel):
    """``GET /api/llm-providers/{id}/quota`` 响应。

    - GLM 正常 → ``quota`` 含 ``windows``（5 小时窗 / 周限额，含剩余与重置时间）；
    - 非 GLM / 上游失败 / 无数据 → ``quota=None``（HTTP 200，绝不 5xx，D-009）。
    """

    quota: LlmProviderQuotaData | None = None


# ── set/unset_default 结构化响应（task-05 / FR-07）──────────────────────────────


class SetDefaultResult(BaseModel):
    """``POST /api/llm-providers/{id}/set-default`` 与 ``unset-default`` 统一响应。

    task-05（change 2026-08-06-provider-switch-live-session / FR-07）：把 task-03
    service 层 ``DefaultSwitchResult``（dataclass）透传给前端的响应 DTO，供前端区分
    立即生效（``switched=True`` + ``affected_sessions>0``）、等待 turn 边界
    （``switched=True`` + ``affected_sessions=0``）与凭证失败（``switched=False`` +
    ``error``）三种状态，对应不同 toast 文案（task-09）。

    纯响应 DTO（无 ``from_attributes``）：router 显式按字段名从 ``DefaultSwitchResult``
    构造，不直接 ``model_validate`` dataclass（风格对齐 ``UsageResult``）。

    - ``switched``：本次 set/unset 是否成功变更 ``is_default``（set 凭证探测失败回滚
      时为 ``False``；unset 恒为 ``True``）；
    - ``affected_sessions``：``notify_provider_switch`` 成功投递的 active interactive
      session 计数（D-001）；无 active session 或 notify 异常时为 ``0``；
    - ``error``：set 凭证探测失败原因（仅 ``switched=False`` 时有值）；成功 / unset 为 ``None``。
    """

    switched: bool
    affected_sessions: int
    error: str | None = None
    # task-09（D-003 / R-09）：openai 格式 set-default 联动 LiteLLM 注册结果（True/False）；
    # anthropic 格式 / 凭证失败 / unset 场景为 None。前端据 False 提示
    # 「网关注册失败，Claude Code 暂不可用，请重试或联系管理员」（design §10 R-09 已知降级态）。
    litellm_registered: bool | None = None
