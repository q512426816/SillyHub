"""凭证探测（task-01 / D-003）。

``set_default`` 切换默认供应商前，先轻量请求验 key/base_url 有效性：
- 默认 GET ``<base_url>/v1/models`` 探测（Anthropic 兼容端点通常支持该路径）；
- 复用 ``service.py`` 的 ``_build_auth_headers`` / ``_candidate_urls`` /
  ``_FETCH_TIMEOUT`` 及 SSRF 防护范式（``ToolPolicyService.assert_public_hostname``）；
- 失败（401/403 / 网络异常 / 超时 / SSRF 拒绝 / 候选耗尽）归类返回
  ``ProviderProbeResult(ok=False, error=...)``，**不抛异常**（D-003：保留原供应商，
  不破坏运行中会话；上层 set_default 失败仅回滚 + 前端提示）；
- 明文 api_key 绝不入日志 / 返回值（R-02）。

spike-01 凭证处理：用户未提供真实 GLM/kimi 凭证，探测形态先用 GET /v1/models 默认实现，
代码留 TODO 注释，待实测 GLM/kimi 兼容端点后确认/调整探测形态（列模型 / 极简 completion）。

可注入性：测试通过 ``patch(...probe.httpx.AsyncClient)`` mock 网络（同 fetch_models 范式），
避免真实请求；函数无 DB 依赖（无状态查询，design §9 豁免生命周期契约）。
"""

from __future__ import annotations

from urllib.parse import urlparse

import httpx
from pydantic import BaseModel

from app.core.logging import get_logger
from app.modules.llm_provider.service import LlmProviderService
from app.modules.tool_gateway.tool_policy import SsrfBlocked, ToolPolicyService

log = get_logger(__name__)


class ProviderProbeResult(BaseModel):
    """凭证探测结果（task-01 contract / design §7）。

    - ``ok=True``：上游 200，凭证有效；
    - ``ok=False`` + ``error``：失败原因（鉴权失败 / 网络错 / 超时 / SSRF 拒绝 / 候选耗尽），
      不抛异常（D-003）。明文 api_key 永不进该结构（R-02）。
    """

    ok: bool
    error: str | None = None


async def probe_provider(
    base_url: str,
    api_key: str,
    auth_field: str = "ANTHROPIC_AUTH_TOKEN",
    model: str | None = None,
    api_format: str = "anthropic",
) -> ProviderProbeResult:
    """轻量请求验 key/base_url 有效性（task-01 / D-003）。

    探测形态（spike-01）：默认 GET ``<base_url>/v1/models``。
    TODO(spike-01)：实测 GLM/kimi 兼容端点后确认/调整探测形态——若 /v1/models 不通，
    改为极简 messages completion 二选一（task-01 implementation 第 1 条）。

    候选 URL + 鉴权头按 ``api_format`` 走（task-02 / FR-03/FR-04，复用 service helper，
    单一来源防漂移）：
    - ``openai_chat``：``_strip_openai_suffix`` 归一后产 ``[base/models, base/v1/models]``
      + 恒 Bearer；
    - ``anthropic``：``base + /v1/models`` → 剥离 ``/anthropic``/``/compatibility``/``/api``
      子路径再试 + auth_field 鉴权头。逐字不变（NFR-02）。

    失败归类（不抛异常）：
    - 401/403 → 立即返回鉴权失败（再试其它候选也是 401/403，无意义）；
    - SSRF 拒绝 → 立即返回安全策略拒绝（私网/保留 IP 或 DNS 失败）；
    - 网络错 / 超时 / 非 200 状态 → 记录并尝试下一候选；全候选耗尽 → 返回最后一次失败原因。

    Args:
        base_url: 上游 base URL（含 scheme + host，可带 /anthropic 等子路径）。
        api_key: 明文 API Key（仅局部变量，永不入日志 / 返回值，R-02）。
        auth_field: 鉴权头字段（``ANTHROPIC_AUTH_TOKEN`` 默认 → Bearer；
            ``ANTHROPIC_API_KEY`` → x-api-key + anthropic-version）。openai_chat 时忽略（D-002@v1）。
        model: 预留参数（/v1/models 探测形态不使用；spike-01 若改 completion 形态会用到）。
        api_format: API 格式（``anthropic`` 默认 / ``openai_chat``），决定鉴权头与候选 URL。

    Returns:
        ``ProviderProbeResult``：``ok=True`` 凭证有效；``ok=False`` + ``error`` 失败原因。

    明文 api_key 仅局部变量，永不入响应 / 日志（NFR-02 / R-02，同 fetch_models）。
    """
    headers = LlmProviderService._build_auth_headers(api_key, auth_field, api_format)
    candidates = LlmProviderService._candidate_urls(base_url, api_format)
    timeout = LlmProviderService._FETCH_TIMEOUT  # 10s（NFR-03，同 fetch_models）

    last_status: int | None = None
    last_kind: str = "unknown"
    for url in candidates:
        # SSRF 防护（D-006 / R-02）：候选 URL 发请求前先解析域名 IP，拒绝私网/保留/解析失败。
        # 复用 fetch_models 范式（IPv4 + IPv6 + getaddrinfo 包 asyncio.to_thread 防阻塞）。
        host = urlparse(url).hostname or ""
        try:
            await ToolPolicyService.assert_public_hostname(host)
        except SsrfBlocked:
            # 安全侧拒绝 → 立即终止（私网地址换候选也是私网，无意义）
            return ProviderProbeResult(ok=False, error="上游地址被安全策略拒绝（SSRF 防护）")

        # TODO(spike-01)：实测 GLM/kimi 兼容端点后确认探测形态（GET /v1/models 默认）。
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, headers=headers)
        except httpx.TimeoutException:
            last_status = None
            last_kind = "timeout"
            continue
        except httpx.HTTPError:
            # 连接 / 协议错（DNS 失败、连接拒绝、TLS 错等）→ 尝试下一候选
            last_status = None
            last_kind = "network_error"
            continue

        if resp.status_code in (401, 403):
            # 凭证被上游拒 → 立即终止（再试其它 URL 也是 401/403，无意义）
            return ProviderProbeResult(ok=False, error=f"鉴权失败（HTTP {resp.status_code}）")
        if resp.status_code == 200:
            return ProviderProbeResult(ok=True)

        # 404 / 405 / 5xx 等 → 记录并尝试下一候选
        last_status = resp.status_code
        last_kind = f"http_{resp.status_code}"

    # 全候选耗尽：按最后一次失败类型归类（不抛异常，D-003）
    if last_status is not None:
        return ProviderProbeResult(ok=False, error=f"凭证探测失败：上游返回 HTTP {last_status}")
    return ProviderProbeResult(ok=False, error=f"凭证探测失败：{last_kind}")
