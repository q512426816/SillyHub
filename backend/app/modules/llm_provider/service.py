"""LlmProvider CRUD + 加密 + 默认互斥 + owner 过滤。

照 ``git_identity/service.py`` 范式：
- ``__init__(session, *, cipher=None)`` + lazy ``_default_cipher()`` 调 ``get_cipher()``；
- ``create/update`` 先 ``cipher.encrypt(api_key)`` 再赋 ``encrypted_api_key``（明文永不入 ORM，R-04）；
- ``(user_id, agent_kind)`` 维度 ``is_default`` 互斥（事务内先清同组再置，R-05）；
- 所有方法按 ``user_id`` 过滤（D-008 owner 级），跨用户访问 → 404/403 不泄漏存在性。
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import CredentialCipher
from app.core.errors import AppError, PermissionDenied
from app.core.logging import get_logger
from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.schema import (
    FetchModelsItem,
    FetchModelsRequest,
    FetchModelsResponse,
    LlmProviderCreate,
    LlmProviderRead,
    LlmProviderUpdate,
    UsageData,
    UsageResult,
)
from app.modules.llm_provider.usage_handlers import (
    UsageUpstreamError,
    query_deepseek,
    query_kimi,
    query_minimax,
    query_openrouter,
    query_siliconflow,
    query_zhipu,
)
from app.modules.tool_gateway.tool_policy import SsrfBlocked, ToolPolicyService

log = get_logger(__name__)


class LlmProviderNotFound(AppError):
    code = "HTTP_404_LLM_PROVIDER_NOT_FOUND"
    http_status = 404


# ── fetch-models 错误分类（task-02 / D-006）──────────────────────────────────
# 4 类事件码遵循既有 AppError ``HTTP_<status>_<EVENT>`` 命名范式（N818 ignore）。


class LlmProviderAuthFailed(AppError):
    """上游 401/403 → 凭证被拒（不区分 key 错还是权限不够，前端统一提示鉴权失败）。"""

    code = "HTTP_401_LLM_PROVIDER_AUTH_FAILED"
    http_status = 401


class LlmProviderModelsUnsupported(AppError):
    """所有候选 URL 终态 404/405 → 上游未开放 /v1/models（中转站常见）。"""

    code = "HTTP_404_LLM_PROVIDER_MODELS_UNSUPPORTED"
    http_status = 404


class LlmProviderModelsAllFailed(AppError):
    """全部候选 URL 都失败（非 404/405 类终态，如 5xx / 网络 / 解析错）。"""

    code = "HTTP_502_LLM_PROVIDER_MODELS_ALL_FAILED"
    http_status = 502


class LlmProviderModelsTimeout(AppError):
    """上游 /v1/models 请求超时（10s，NFR-03）。"""

    code = "HTTP_504_LLM_PROVIDER_MODELS_TIMEOUT"
    http_status = 504


class LlmProviderSsrfBlocked(AppError):
    """候选 base_url 解析到私网/保留 IP 或 DNS 解析失败 → 安全侧拒绝（task-03 / D-006）。

    复用 ``tool_policy.ToolPolicyService.assert_public_hostname``（IPv4 + IPv6
    + ``getaddrinfo`` 包 ``asyncio.to_thread`` 防阻塞）；解析失败（``gaierror``）
    同样拒绝，不 fallback、不抛裸 ``OSError``。本类把跨模块的 ``SsrfBlocked``
    信号翻译回 llm_provider 自身的错误范式（与 task-02 四类错误对齐）。
    """

    code = "HTTP_400_LLM_PROVIDER_SSRF_BLOCKED"
    http_status = 400


# ── usage 查询错误分类（task-03 / D-005）──────────────────────────────────────


class LlmProviderUsageTransient(AppError):
    """用量查询瞬时失败（网络 / 5xx / 429 / 超时 / 读体中断）→ 5xx。

    前端见 5xx → 保留上次成功值 10 分钟（D-005）。本类仅在 service 层 raise，
    router 不 try/except，自然冒泡交全局异常处理器转 5xx（同 fetch-models 范式）。
    """

    code = "HTTP_502_LLM_PROVIDER_USAGE_TRANSIENT"
    http_status = 502


# detect_provider(base_url) 路由键 → 各家硬编码 handler（task-02 产出）。
# detect 不加 DB 字段，纯 base_url 子串匹配（D-004）。
_USAGE_HANDLERS: dict[str, Callable[[httpx.AsyncClient, str, str], Awaitable[list[UsageData]]]] = {
    "deepseek": query_deepseek,
    "siliconflow": query_siliconflow,
    "openrouter": query_openrouter,
    "kimi": query_kimi,
    "zhipu": query_zhipu,
    "minimax": query_minimax,
}


# ── set/unset_default 结构化结果（task-03 / design §7）─────────────────────────


@dataclass
class DefaultSwitchResult:
    """``set_default`` / ``unset_default`` 返回值（task-03 / D-001 / D-003 / D-004）。

    task-05 ``router`` 据此构造 ``schema.SetDefaultResult`` 响应（FR-07 三字段：
    ``switched`` / ``affected_sessions`` / ``error``）。service 层用 dataclass
    而非 Pydantic —— 与 ``schema.py``（task-05 allowed_paths）解耦，router 仅按
    字段名读取后转 ``SetDefaultResult``。

    字段：
    - ``switched``：本次 set/unset 是否成功变更 ``is_default``。set 凭证探测失败
      回滚时为 ``False``（D-003）；unset 恒为 ``True``（不探测，置 False 不会失败）。
    - ``affected_sessions``：``notify_provider_switch`` 成功投递的 active interactive
      session 计数（D-001）；无 active session 或 notify 异常时为 ``0``。
    - ``error``：set 凭证探测失败原因（D-003）；成功 / unset 场景为 ``None``。
    """

    switched: bool
    affected_sessions: int
    error: str | None = None
    # task-09（D-003 / R-09）：openai 格式 set-default 联动 LiteLLM 注册结果（True/False）；
    # anthropic 格式 / 凭证失败 / unset 场景为 None（router 透传 SetDefaultResult.litellm_registered）。
    litellm_registered: bool | None = None


class LlmProviderService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        cipher: CredentialCipher | None = None,
    ) -> None:
        self._session = session
        self._cipher = cipher or self._default_cipher()

    @staticmethod
    def _default_cipher() -> CredentialCipher:
        from app.core.crypto import get_cipher

        return get_cipher()

    # ── CRUD ──────────────────────────────────────────────────────────

    async def list_(self, user_id: uuid.UUID) -> list[LlmProvider]:
        stmt = (
            select(LlmProvider)
            .where(LlmProvider.user_id == user_id)
            .order_by(LlmProvider.created_at.desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, provider_id: uuid.UUID, user_id: uuid.UUID) -> LlmProvider:
        stmt = select(LlmProvider).where(LlmProvider.id == provider_id)
        row = (await self._session.execute(stmt)).scalars().first()
        if row is None:
            raise LlmProviderNotFound(
                "模型供应商不存在，请刷新后重试。",
                details={"provider_id": str(provider_id)},
            )
        if row.user_id != user_id:
            raise PermissionDenied("无权操作他人的模型供应商配置。")
        return row

    async def create(
        self,
        user_id: uuid.UUID,
        data: LlmProviderCreate,
    ) -> LlmProvider:
        ct, key_id = self._cipher.encrypt(data.api_key or "")
        if data.is_default:
            await self._clear_sibling_defaults(user_id, data.agent_kind)
        row = LlmProvider(
            id=uuid.uuid4(),
            user_id=user_id,
            name=data.name,
            agent_kind=data.agent_kind,
            base_url=data.base_url,
            encrypted_api_key=ct,
            key_id=key_id,
            model=data.model,
            notes=data.notes,
            website_url=data.website_url,
            auth_field=data.auth_field,
            api_format=data.api_format,
            model_role_mappings=data.model_role_mappings,
            default_fallback_model=data.default_fallback_model,
            extra_env=data.extra_env,
            settings_config=data.settings_config,
            is_default=data.is_default,
            multimodal=data.multimodal or "auto",
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        log.info(
            "llm_provider.created",
            provider_id=str(row.id),
            user_id=str(user_id),
            agent_kind=row.agent_kind,
        )
        return row

    async def update(
        self,
        provider_id: uuid.UUID,
        user_id: uuid.UUID,
        data: LlmProviderUpdate,
    ) -> LlmProvider:
        row = await self.get(provider_id, user_id)
        updates = data.model_dump(exclude_unset=True)

        # api_key 单独处理：None = 不动原密钥；非 None 才重新加密
        new_api_key = updates.pop("api_key", None)
        if new_api_key is not None:
            ct, key_id = self._cipher.encrypt(new_api_key)
            row.encrypted_api_key = ct
            row.key_id = key_id

        # 2026-08-20 task-12：multimodal 三态——显式 None 不覆盖（不传=不动）。
        if updates.get("multimodal") is None:
            updates.pop("multimodal", None)

        # is_default 互斥：置 True 前先清同 (user_id, agent_kind) 兄弟行
        want_default = updates.pop("is_default", None)
        if want_default:
            await self._clear_sibling_defaults(row.user_id, row.agent_kind, except_id=row.id)

        for field, value in updates.items():
            setattr(row, field, value)
        if want_default is not None:
            row.is_default = want_default

        await self._session.commit()
        await self._session.refresh(row)
        log.info("llm_provider.updated", provider_id=str(row.id))
        return row

    async def delete(self, provider_id: uuid.UUID, user_id: uuid.UUID) -> None:
        row = await self.get(provider_id, user_id)
        # task-09 / D-003：openai 格式联动注销 LiteLLM（delete 行前注销，best-effort 不阻塞）。
        # anthropic 格式不经 LiteLLM 跳过。
        if row.api_format == "openai_chat":
            from app.modules.llm_provider import litellm_client

            await litellm_client.unregister(litellm_client.litellm_model_name(row.user_id, row.id))
        await self._session.delete(row)
        await self._session.commit()
        log.info("llm_provider.deleted", provider_id=str(provider_id))

    async def set_default(
        self,
        provider_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DefaultSwitchResult:
        """置本行为默认供应商（cc-switch 式「启动」）。

        task-03 改造（change 2026-08-06-provider-switch-live-session / D-001 / D-003）：

        1. **凭证探测**：先 ``probe_provider``（task-01）轻量请求验 base_url + 解密
           api_key + auth_field + model；**失败**（``ok=False``）→ **不改 is_default、
           不推送**，返回结构化 ``error``（D-003 回滚：原供应商继续服务运行中会话，
           不破坏 G4）。事务内此时仅有 SELECT（``self.get``）无任何 write，回滚 = 不写入。
        2. **互斥置位**：探测成功后事务内 ``_clear_sibling_defaults`` 清同
           (user_id, agent_kind) 兄弟行 + 置本行 True（R-05 并发互斥，原子 commit）。
        3. **触发热切换**：调 ``resolve_default_provider_config``（task-02 D-006 单一
           真相源）构造新 config → ``notify_provider_switch``（task-04）向 active
           interactive session 推 ``PROVIDER_CONFIG_CHANGED``（D-001 WS 触发）。
           notify best-effort（D-001 / design §9）：失败仅日志告警、不阻塞 set 成功
           （DB 已 commit，is_default 已变更；热切换即时性降级，新会话仍走 claim 正常
           注入新默认）。

        返回 ``DefaultSwitchResult``（task-05 router 包装为 ``SetDefaultResult`` 响应）：
        - 成功：``switched=True``、``affected_sessions=notify 投递计数``、``error=None``；
        - 凭证失败：``switched=False``、``affected_sessions=0``、``error=探测失败原因``。
        """
        row = await self.get(provider_id, user_id)

        # ── step 1: 凭证探测（D-003 失败回滚 = 不改 is_default / 不推送）──
        api_key_plain = self._cipher.decrypt(row.encrypted_api_key, row.key_id)
        base_url = row.base_url or ""
        if not base_url or not api_key_plain:
            # 缺凭证信号（base_url 或 api_key 缺失）→ 视同探测失败，保守不切换。
            # 明文 api_key / base_url 不进日志（R-02 / NFR-02）。
            log.warning(
                "llm_provider.set_default_missing_credentials",
                provider_id=str(row.id),
                missing="base_url" if not base_url else "api_key",
            )
            return DefaultSwitchResult(
                switched=False,
                affected_sessions=0,
                error="缺少 base_url 或 API Key，无法切换默认供应商",
            )

        # lazy import：probe.py 顶层 ``from ...service import LlmProviderService`` 会与
        # 本模块互循环，必须函数内导入（同 ws_hub / spawn-env 范式）。测试 patch
        # ``app.modules.llm_provider.probe.probe_provider`` 源模块（lazy ``from ... import``
        # 在调用时按属性查找源模块当前绑定）。
        from app.modules.llm_provider.probe import probe_provider

        probe_result = await probe_provider(
            base_url=base_url,
            api_key=api_key_plain,
            auth_field=row.auth_field,
            model=row.model,
            api_format=row.api_format,
        )
        if not probe_result.ok:
            # D-003：凭证无效 → 不改 is_default、不推送，原供应商继续服务运行中会话。
            # probe_result.error 文案安全（task-01 不含上游 body / 明文 key，R-02）。
            log.warning(
                "llm_provider.set_default_probe_failed",
                provider_id=str(row.id),
                error=probe_result.error,
            )
            return DefaultSwitchResult(
                switched=False,
                affected_sessions=0,
                error=probe_result.error or "凭证探测失败",
            )

        # ── step 2: 事务内清同组兄弟 + 置本行 True（R-05 互斥，原子 commit）──
        await self._clear_sibling_defaults(row.user_id, row.agent_kind, except_id=row.id)
        row.is_default = True
        await self._session.commit()
        await self._session.refresh(row)
        log.info("llm_provider.set_default", provider_id=str(row.id))

        # ── step 2.5: openai 格式联动注册 LiteLLM（task-09 / D-003 / R-09 best-effort）──
        # is_default 已 commit 不可回滚；register 失败仅 litellm_registered=False（前端 toast 提示
        # 网关注册失败），不阻塞 set 成功（design §10 R-09 已知降级态，优于静默成功）。anthropic
        # 格式不经 LiteLLM，litellm_registered=None。明文 key 仅传 LiteLLM 请求体（R-02）。
        litellm_registered: bool | None = None
        if row.api_format == "openai_chat":
            from app.modules.llm_provider import litellm_client

            litellm_registered = await litellm_client.register(
                row, user_id=row.user_id, cipher=self._cipher
            )

        # ── step 3: 触发热切换推送（D-001 / D-006 单一真相源 helper）──
        affected = await self._dispatch_provider_switch(row.user_id, row.agent_kind, unset=False)
        return DefaultSwitchResult(
            switched=True,
            affected_sessions=affected,
            litellm_registered=litellm_registered,
        )

    async def unset_default(
        self,
        provider_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DefaultSwitchResult:
        """取消本行默认（cc-switch 式「停止」）。

        task-03 改造（change 2026-08-06-provider-switch-live-session / D-001 / D-004）：

        对称 ``set_default`` 的「启动」，**不探测**（停止无新凭证可验），仅置本行
        ``is_default=False``，**不清兄弟** —— 取消不会波及其它行
        （``_clear_sibling_defaults`` 仅在置 True 时触发）。幂等：对本就 False 的行
        取消是 no-op（不抛错）。

        置 False 后调 ``notify_provider_switch``（task-04）推 ``provider_config=None``，
        daemon 据此回退宿主机本机凭证管理（D-004 / design §5 Wave1 / spawn-env.ts 第 0
        层跳过）。notify best-effort（D-001）：失败仅日志告警、不阻塞 unset 成功。

        若取消后该 (user_id, agent_kind) 无任何默认 → lease 不再注入 provider_config
        → 新会话也回归本机（D-007 兼容策略）。

        返回 ``DefaultSwitchResult``：``switched`` 恒 ``True``（unset 不探测、不会失败）、
        ``affected_sessions`` 投递计数、``error`` 恒 ``None``。
        """
        row = await self.get(provider_id, user_id)
        row.is_default = False
        await self._session.commit()
        await self._session.refresh(row)
        log.info("llm_provider.unset_default", provider_id=str(row.id))

        # task-09 / D-003：openai 格式联动注销 LiteLLM（best-effort，不阻塞 unset）。
        # anthropic 格式不经 LiteLLM 跳过。明文 key 不涉及（unregister 只按 model_name）。
        if row.api_format == "openai_chat":
            from app.modules.llm_provider import litellm_client

            await litellm_client.unregister(litellm_client.litellm_model_name(row.user_id, row.id))

        # task-03 / D-004：触发热切换推送（provider_config=None → daemon 回退本机）。
        affected = await self._dispatch_provider_switch(row.user_id, row.agent_kind, unset=True)
        return DefaultSwitchResult(switched=True, affected_sessions=affected)

    async def _dispatch_provider_switch(
        self,
        user_id: uuid.UUID,
        agent_kind: str,
        *,
        unset: bool,
    ) -> int:
        """构造 provider_config 并调 ``notify_provider_switch``（best-effort / D-001）。

        task-03 / D-001 / D-006：set/unset_default 成功变更 ``is_default`` 后调用。

        - ``unset=False``（set 场景）：经 ``resolve_default_provider_config``（task-02）
          查刚置位的默认 provider 并解密构造 9 字段中性 config dict（D-006 单一真相源，
          与 claim 路径共用，避免两处各写一份）。
        - ``unset=True``（unset 场景）：直接传 ``None``，daemon 据此回退本机（D-004）。

        best-effort（D-001 / design §9）：``notify_provider_switch`` 内部已对单 session
        推送异常做 try/except（仅告警）；此处再包一层防御 resolve/notify 整体异常
        （如 DB 连接瞬断、context lazy import 失败）——任何异常均返回 ``0``，不阻塞
        set/unset 成功。set 已 commit、is_default 已持久化，notify 失败只影响热切换
        即时性（运行中会话仍用旧 env 直到自然 turn 边界后下次 claim / 重启）。

        Args:
            user_id: LlmProvider.user_id（owner 级，D-008）。
            agent_kind: LlmProvider.agent_kind（claude / codex，R-05 互斥维度）。
            unset: True = unset_default 推 None；False = set_default 推 resolve 出的新 config。

        Returns:
            ``notify_provider_switch`` 成功投递的 active interactive session 计数；
            异常或无 active session 时返回 ``0``。
        """
        # lazy import：context.py / provider_switch.py 顶层导入较重（agent / daemon /
        # workspace 多模块），且与 service 无互循环；仍函数内导入延迟首次加载并隔离
        # 测试（patch ``provider_switch.notify_provider_switch`` 源模块生效）。
        from app.modules.daemon.lease.context import resolve_default_provider_config
        from app.modules.daemon.lease.provider_switch import notify_provider_switch

        try:
            provider_config: dict | None = (
                None
                if unset
                else await resolve_default_provider_config(self._session, user_id, agent_kind)
            )
            return await notify_provider_switch(self._session, user_id, provider_config)
        except Exception as exc:
            # best-effort（D-001 / design §9）：notify 整体异常不阻塞 set/unset 成功。
            # 明文 api_key / provider_config 内容不进日志（R-02 / NFR-02，仅记 error 类型）。
            log.warning(
                "llm_provider.provider_switch_notify_failed",
                user_id=str(user_id),
                agent_kind=agent_kind,
                unset=unset,
                error=str(exc),
            )
            return 0

    # ── Helpers ───────────────────────────────────────────────────────

    async def _clear_sibling_defaults(
        self,
        user_id: uuid.UUID,
        agent_kind: str,
        *,
        except_id: uuid.UUID | None = None,
    ) -> None:
        """单事务内把同 (user_id, agent_kind) 其它行的 is_default 清成 False。"""
        stmt = (
            update(LlmProvider)
            .where(
                LlmProvider.user_id == user_id,
                LlmProvider.agent_kind == agent_kind,
                LlmProvider.is_default.is_(True),
            )
            .values(is_default=False)
        )
        if except_id is not None:
            stmt = stmt.where(LlmProvider.id != except_id)
        await self._session.execute(stmt)

    def _to_read(self, row: LlmProvider) -> LlmProviderRead:
        plaintext = self._cipher.decrypt(row.encrypted_api_key, row.key_id)
        read = LlmProviderRead.model_validate(row)
        read.api_key_masked = self._mask_api_key(plaintext)
        return read

    @staticmethod
    def _mask_api_key(plaintext: str) -> str | None:
        """X-09：空 → None；<8 位 → ****；>=8 位 → 首4...尾4。"""
        if not plaintext:
            return None
        if len(plaintext) < 8:
            return "****"
        return f"{plaintext[:4]}...{plaintext[-4:]}"

    # ── fetch-models（task-02 / D-001/D-006）──────────────────────────────

    _FETCH_TIMEOUT: float = 10.0  # NFR-03：上游 /v1/models 超时 10s
    _STRIP_SUFFIXES: tuple[str, ...] = ("/anthropic", "/compatibility", "/api")
    _USAGE_TIMEOUT: float = 15.0  # 用量查询上游超时 15s（task-03）

    async def fetch_models(
        self,
        user_id: uuid.UUID,
        data: FetchModelsRequest,
    ) -> FetchModelsResponse:
        """拉上游 ``/v1/models``（无状态查询，design §9 豁免生命周期契约）。

        双形态凭证解析（D-001）：
        - ``provider_id`` → ``self.get(row)`` + ``cipher.decrypt`` 取明文 key + auth_field + base_url；
        - ``{base_url, api_key, auth_field?}`` → 直传不落库不入日志，用完即弃（NFR-02）。

        候选 URL 顺序尝试（NFR-03 不并发防中转站限流）：``base + /v1/models`` → 剥离
        ``/anthropic``/``/compatibility``/``/api`` 子路径再试。

        错误分类（4 类）：401/403→``LlmProviderAuthFailed``；候选终态 404/405→
        ``LlmProviderModelsUnsupported``；全失败→``LlmProviderModelsAllFailed``；
        超时→``LlmProviderModelsTimeout``。明文 key 永不进响应 / 日志。
        """
        base_url, api_key_plain, auth_field, api_format = await self._resolve_fetch_credentials(
            user_id, data
        )
        headers = self._build_auth_headers(api_key_plain, auth_field, api_format)
        candidates = self._candidate_urls(base_url, api_format)

        last_status: int | None = None
        last_kind: str | None = None
        last_url: str | None = None
        for url in candidates:
            # task-03：SSRF 防护（D-006）—— 候选 URL 发请求前先解析域名 IP，拒绝
            # 私网/保留/解析失败。复用 tool_policy.assert_public_hostname（IPv4 +
            # IPv6 + socket.getaddrinfo 包 asyncio.to_thread 防阻塞事件循环）。
            # SsrfBlocked 翻译回 llm_provider 自身错误类（不破坏 task-02 错误分类）。
            host = urlparse(url).hostname or ""
            try:
                await ToolPolicyService.assert_public_hostname(host)
            except SsrfBlocked as exc:
                raise LlmProviderSsrfBlocked(
                    "上游地址被安全策略拦截（SSRF 防护），请检查供应商地址。",
                    details={"url": url, "host": host, **(exc.details or {})},
                ) from exc
            try:
                async with httpx.AsyncClient(timeout=self._FETCH_TIMEOUT) as client:
                    resp = await client.get(url, headers=headers)
            except httpx.TimeoutException as exc:
                raise LlmProviderModelsTimeout(
                    "拉取模型列表超时，请稍后重试。",
                    details={"url": url, "timeout_seconds": self._FETCH_TIMEOUT},
                ) from exc
            except httpx.HTTPError as exc:
                # 连接 / 协议错（DNS 失败、连接拒绝、TLS 错等）：尝试下一候选
                last_status = None
                last_kind = f"network_error:{type(exc).__name__}"
                last_url = url
                continue

            if resp.status_code in (401, 403):
                # 凭证被上游拒 → 立即终止（再试其它 URL 也是 401/403，无意义）
                raise LlmProviderAuthFailed(
                    "上游拒绝了当前凭证，请检查 API Key 是否正确。",
                    details={"status": resp.status_code, "url": url},
                )
            if resp.status_code == 200:
                return self._parse_models_response(resp, url)

            # 404 / 405 / 5xx 等 → 记录并尝试下一候选
            last_status = resp.status_code
            last_kind = f"http_{resp.status_code}"
            last_url = url

        # 全候选耗尽：按最后一次失败类型分类
        if last_status in (404, 405):
            raise LlmProviderModelsUnsupported(
                "该供应商不支持拉取模型列表。",
                details={
                    "last_status": last_status,
                    "tried_urls": candidates,
                },
            )
        raise LlmProviderModelsAllFailed(
            "尝试全部候选地址后仍未拉到模型列表，请稍后重试。",
            details={
                "last_status": last_status,
                "last_kind": last_kind,
                "last_url": last_url,
                "tried_urls": candidates,
            },
        )

    async def _resolve_fetch_credentials(
        self,
        user_id: uuid.UUID,
        data: FetchModelsRequest,
    ) -> tuple[str, str, str, str]:
        """双形态凭证解析 → (base_url, api_key_plain, auth_field, api_format)。

        - ``provider_id``：查行 + ``cipher.decrypt`` 取明文 key；用 row.base_url /
          row.auth_field / row.api_format（编辑态格式从行读，FR-01）。
        - inline：直接取 data 字段（schema validator 已保证 base_url + api_key 同时非空）。
          ``auth_field`` 缺省回退 ``ANTHROPIC_AUTH_TOKEN``；``api_format`` 缺省回退 ``anthropic``
          （NFR-02 零回归，新建态未指定格式时按 anthropic 走）。

        明文 key 仅以局部变量存在，永不落库 / 入日志 / 入响应（NFR-02）。
        """
        if data.provider_id is not None:
            row = await self.get(data.provider_id, user_id)
            # 真实加密 → 解密（与 _to_read 同范式，复用 cipher）
            api_key_plain: str = self._cipher.decrypt(row.encrypted_api_key, row.key_id)
            base_url: str | None = row.base_url
            auth_field: str = row.auth_field
            api_format: str = row.api_format
        else:
            # inline 形态：schema validator 保证非 None，做类型 narrowing
            assert data.base_url is not None and data.api_key is not None
            api_key_plain = data.api_key
            base_url = data.base_url
            auth_field = data.auth_field or "ANTHROPIC_AUTH_TOKEN"
            api_format = data.api_format or "anthropic"

        if not base_url:
            raise LlmProviderModelsUnsupported(
                "该供应商未配置接口地址，无法拉取模型列表。",
                details={"reason": "missing_base_url"},
            )
        if not api_key_plain:
            raise LlmProviderAuthFailed(
                "该供应商未配置 API Key，无法完成鉴权。",
                details={"reason": "missing_api_key"},
            )
        return base_url, api_key_plain, auth_field, api_format

    @classmethod
    def _build_auth_headers(
        cls,
        api_key: str,
        auth_field: str,
        api_format: str = "anthropic",
    ) -> dict[str, str]:
        """按 api_format + auth_field 产鉴权头（FR-03 / D-002@v1）。

        - ``openai_chat`` → 恒 ``Authorization: Bearer <key>``（忽略 auth_field，D-002@v1）；
        - ``ANTHROPIC_API_KEY`` → ``x-api-key: <key>`` + ``anthropic-version: 2023-06-01``；
        - ``ANTHROPIC_AUTH_TOKEN``（默认）→ ``Authorization: Bearer <key>``。
        """
        if api_format == "openai_chat":
            return {"Authorization": f"Bearer {api_key}"}
        if auth_field == "ANTHROPIC_API_KEY":
            return {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }
        return {"Authorization": f"Bearer {api_key}"}

    @classmethod
    def _strip_openai_suffix(cls, base_url: str) -> str:
        """剥 OpenAI 完整端点 URL 尾部 ``/chat/completions`` → 得 base（FR-02 / D-001@v1）。

        兼容尾斜杠；非标准 URL（尾部无 ``/chat/completions``）原样返回（R-06 兜底，不抛错）。
        例：``https://x/v1/chat/completions`` → ``https://x/v1``；
        ``https://x/v1/chat/completions/`` → ``https://x/v1``；``https://x/v1`` → ``https://x/v1``。
        """
        base = base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base[: -len("/chat/completions")]
        return base

    @classmethod
    def _candidate_urls(cls, base_url: str, api_format: str = "anthropic") -> list[str]:
        """候选 URL 列表（顺序尝试，NFR-03 不并发防中转站限流）。

        - ``openai_chat``：先 ``_strip_openai_suffix`` 归一完整端点 URL，再产
          ``[base/models, base/v1/models]``（兼容 base 是否含 /v1，FR-04）；
        - ``anthropic``：主候选 = ``base_url.rstrip('/') + '/v1/models'``；若 base 尾部含
          ``/anthropic`` / ``/compatibility`` / ``/api`` 子路径 → 剥离后再加一候选
          （cc-switch 范式，对中转站 404 兜底）。逐字不变（NFR-02）。
        """
        if api_format == "openai_chat":
            base = cls._strip_openai_suffix(base_url)
            result = [f"{base}/models"]
            v1_url = f"{base}/v1/models"
            if v1_url not in result:
                result.append(v1_url)
            return result

        base = base_url.rstrip("/")
        candidates: list[str] = [f"{base}/v1/models"]
        for suffix in cls._STRIP_SUFFIXES:
            if base.endswith(suffix):
                stripped = base[: -len(suffix)]
                url = f"{stripped}/v1/models"
                if url not in candidates:
                    candidates.append(url)
        return candidates

    @staticmethod
    def _parse_models_response(
        resp: httpx.Response,
        url: str,
    ) -> FetchModelsResponse:
        """解析上游 /v1/models 响应（OpenAI 兼容 ``{data: [{id, owned_by, ...}]}``）。

        Anthropic 官方 /v1/models 不返 ``owned_by`` → 该字段缺失视为 None。
        非 200 由调用方分类；200 但 body 不可解析 → ``LlmProviderModelsAllFailed``。
        """
        try:
            body = resp.json()
        except ValueError as exc:
            raise LlmProviderModelsAllFailed(
                "上游返回了无法解析的响应内容，请稍后重试。",
                details={"url": url, "parse_error": str(exc)},
            ) from exc
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            raise LlmProviderModelsAllFailed(
                "上游响应缺少模型列表字段，请稍后重试。",
                details={"url": url},
            )
        models: list[FetchModelsItem] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            item_id = item.get("id")
            if not isinstance(item_id, str):
                continue
            owned = item.get("owned_by")
            models.append(
                FetchModelsItem(
                    id=item_id,
                    owned_by=owned if isinstance(owned, str) else None,
                )
            )
        return FetchModelsResponse(models=models)

    # ── usage 查询（task-03 / D-002/D-004/D-005/D-009）───────────────────────────

    async def query_usage(
        self,
        provider_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> UsageResult:
        """查供应商用量（余额 / 套餐额度），后端代查（D-002）。

        无状态查询（design §8 豁免生命周期契约）：解密 api_key + ``_detect_usage_provider``
        按 base_url 路由（D-004，不加 DB 字段）→ task-02 handler → 统一 ``UsageResult``。
        明文 key 仅局部变量，永不入响应 / 日志（NFR-02，同 fetch-models）。

        错误两态（D-005）：
        - 瞬时（网络 / 5xx / 429 / 超时 / 读体中断）→ ``raise LlmProviderUsageTransient``
          （5xx，router 不吞，前端保留上次成功值 10 分钟）；
        - 确定性（401/403 鉴权 → ``success:false`` + ``is_valid:False`` 翻红；404/空 key /
          未知供应商 / 解析失败 / 业务错 / SSRF → ``success:false`` 灰提示）。
        """
        row = await self.get(provider_id, user_id)  # owner 校验：跨用户 404/403 不泄漏

        api_key_plain = self._cipher.decrypt(row.encrypted_api_key, row.key_id)
        base_url = row.base_url or ""
        if not base_url or not api_key_plain:
            return UsageResult(success=False, error="缺少 base_url 或 API Key，无法查询用量")

        provider = self._detect_usage_provider(base_url)
        if provider is None:
            return UsageResult(success=False, error="该供应商暂不支持余额查询")
        handler = _USAGE_HANDLERS[provider]

        # SSRF（D-009）：6 家用量端点均与 base_url 同 host，故对 base_url 的 host 做一次
        # assert_public_hostname 即覆盖。复用 fetch-models 范式（IPv4 + IPv6 + getaddrinfo
        # 包 asyncio.to_thread 防阻塞事件循环）。
        host = urlparse(base_url).hostname or ""
        try:
            await ToolPolicyService.assert_public_hostname(host)
        except SsrfBlocked:
            return UsageResult(success=False, error="上游地址被安全策略拒绝")

        try:
            async with httpx.AsyncClient(timeout=self._USAGE_TIMEOUT) as client:
                tiers = await handler(client, base_url, api_key_plain)
        except httpx.TimeoutException as exc:
            raise LlmProviderUsageTransient(
                "用量查询超时，请稍后重试。",
                details={"provider": provider, "timeout_seconds": self._USAGE_TIMEOUT},
            ) from exc
        except httpx.HTTPError as exc:
            # 连接 / 协议错（DNS 失败、连接拒绝、TLS、读体中断）：瞬时
            raise LlmProviderUsageTransient(
                "用量查询暂时不可用，请稍后重试。",
                details={"provider": provider, "kind": type(exc).__name__},
            ) from exc
        except UsageUpstreamError as exc:
            return self._classify_usage_upstream_error(provider, exc)

        return UsageResult(success=True, data=tiers, error=None)

    @staticmethod
    def _classify_usage_upstream_error(
        provider: str,
        exc: UsageUpstreamError,
    ) -> UsageResult:
        """把 task-02 的 ``UsageUpstreamError`` 翻译成两态 ``UsageResult``（D-005）。

        - 401/403 → 确定性鉴权失败：``data=[{is_valid:False}]``（前端翻红）；
        - 429 / 5xx → **raise** ``LlmProviderUsageTransient``（瞬时，前端保留上次值）；
        - 其它 4xx / 解析失败 / 业务错（``status_code=None``）→ 确定性灰提示。

        上游 body 仅记 debug 日志（不含 api_key），**不**回传前端（防上游回显泄漏）。
        本方法对瞬时分支会 raise 而非 return，调用方 ``except`` 块据此传播。
        """
        status = exc.status_code
        if status in (401, 403):
            log.info(
                "llm_provider.usage_auth_failed",
                provider=provider,
                status=status,
            )
            return UsageResult(
                success=False,
                data=[
                    UsageData(
                        is_valid=False,
                        invalid_message="鉴权失败，请检查 API Key",
                    )
                ],
                error=f"上游鉴权失败（HTTP {status}）",
            )
        if status is not None and (status == 429 or status >= 500):
            raise LlmProviderUsageTransient(
                "用量查询暂时不可用，请稍后重试。",
                details={"provider": provider, "status": status},
            )
        # 确定性：404/400/解析失败/业务错 → 灰提示（文案安全，不含上游 body）
        log.warning(
            "llm_provider.usage_upstream_error",
            provider=provider,
            status=status,
        )
        if status is None:
            return UsageResult(success=False, error="用量查询失败：上游响应异常")
        return UsageResult(success=False, error=f"用量查询失败（HTTP {status}）")

    @staticmethod
    def _detect_usage_provider(base_url: str) -> str | None:
        """按 base_url 子串路由 balance/token_plan（照 cc-switch balance.rs:26 /
        coding_plan.rs:25，D-004 不加 DB 字段）。

        - DeepSeek / 硅基（.cn/.com）/ OpenRouter → balance；
        - Kimi（api.kimi.com，Kimi 与 Kimi For Coding 同 coding 端点）/ 智谱
          （bigmodel.cn / api.z.ai）/ MiniMax（.cn/.io）→ token_plan；
        - 其余（含 api.moonshot.cn 通用 Kimi、百炼、Anthropic 官方）→ None（不支持）。
        """
        url = (base_url or "").lower()
        if "api.deepseek.com" in url:
            return "deepseek"
        if "siliconflow.cn" in url or "siliconflow.com" in url:
            return "siliconflow"
        if "openrouter.ai" in url:
            return "openrouter"
        if "api.kimi.com" in url:
            return "kimi"
        if "bigmodel.cn" in url or "api.z.ai" in url:
            return "zhipu"
        if "api.minimaxi.com" in url or "api.minimax.io" in url:
            return "minimax"
        return None
