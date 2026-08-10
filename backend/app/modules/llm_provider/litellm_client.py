"""LiteLLM admin API 客户端（Wave2，openai 格式供应商经 LiteLLM 转 Anthropic↔OpenAI）。

design D-004/D-012（平台不实现转换，外包服务器 LiteLLM）+ §5.3 + §7.5 生命周期契约表
「set-default(openai) / unset-default(openai) / delete provider(openai)」三事件 + §10 R-09
（best-effort 降级：register/unregister 失败不阻塞 is_default 变更）+ R-03（model_name 全局
唯一 usr-<uid>-<pid>）+ R-02/NFR-01（上游 api_key 仅出现在 register 请求体，不入日志/响应/审计）。

封装 LiteLLM admin API（spike-litellm-routing 全 4 项实测 2026-08-09 + gap-A 二次诊断 2026-08-10：
POST /model/new + master key 鉴权确认；delete 按 model_id（非 model_name）；litellm_params.model
必须 ``openai/<model>`` 前缀（不带 provider 字段）；**显式 model_info.mode=chat 强制 Chat Completions**
（litellm 1.95.0 对 openai 上游默认走 Responses API → opencode /responses 返 Responses 格式 →
openai adapter 解析失败；mode=chat 实测 /v1/chat/completions 全场景 + /v1/messages 流式含 tools 全 ✅））：
- ``register(provider, *, user_id, cipher)``：POST /model/new 注册 model_name=usr-<uid>-<pid>，
  best-effort（异常返回 False 不抛，R-09）。spike 实测重复注册返 200 创建多 deployment（非幂等
  400/409，功能等价——LiteLLM 按 model_name 路由同上游 simple-shuffle 轮询无害）。
- ``unregister(model_name)``：GET /model/info 找 model_name 匹配的 model_id → 逐个 POST /model/delete
  {id: model_id}（spike 实测 delete 要 model_id 非 model_name；处理重复注册多 deployment），best-effort 静默。
- ``litellm_model_name(user_id, provider_id)``：命名约定 helper，task-10 context.py 复用（逐字一致）。

明文 api_key 仅出现在 register 请求体（litellm_params.api_key），永不进日志（log 行只记
model_name / status / error 类型，R-02）。
"""

from __future__ import annotations

import uuid

import httpx

from app.core.config import get_settings
from app.core.crypto import CredentialCipher
from app.core.logging import get_logger
from app.modules.llm_provider.model import LlmProvider

log = get_logger(__name__)

# LiteLLM admin API 超时（R-09 best-effort，不阻塞 set/unset/delete 主流程）。
_LITELLM_TIMEOUT: float = 10.0


def litellm_model_name(user_id: uuid.UUID, provider_id: uuid.UUID) -> str:
    """LiteLLM model_name 命名约定：``f"usr-{user_id}-{provider_id}"``（R-03 全局唯一）。

    task-09 register + task-10 context.py provider_config.litellm_model_name + task-12 联调
    必须逐字一致，否则 LiteLLM 按 model_name 路由不命中 → Claude Code 报错。UUID 用 str
    形式（含连字符，LiteLLM model_name 接受字符串）。
    """
    return f"usr-{user_id}-{provider_id}"


async def register(
    provider: LlmProvider,
    *,
    user_id: uuid.UUID,
    cipher: CredentialCipher,
) -> bool:
    """注册 provider 到 LiteLLM admin API（POST /model/new，best-effort）。

    body: ``model_name=usr-<uid>-<pid>``, ``litellm_params={model(openai/<model> 前缀), api_base(剥
    /chat/completions), api_key(明文)}``（spike 第 2 项实测：**不带 provider 字段**，靠 model 前缀路由；
    纯名+provider 字段会导致 router upsert 失败 deployment 被 drop）。spike 实测（2026-08-09）：重复
    注册返 200 创建新 deployment（非 400/409 "Already present"），功能等价（LiteLLM 按 model_name 路由
    同上游轮询无害）；200/201/400/409 均视成功保证 set-default 可重试。
    任何异常（httpx/网络/解析/非 2xx 非 409）catch 返回 False，不向上抛（R-09 降级：set_default
    已 commit is_default=True，register 失败仅 litellm_registered=False 供前端 toast 提示）。

    明文 api_key 仅放请求体 litellm_params.api_key，永不进日志（R-02/NFR-01）。

    Returns:
        True = 注册成功（含幂等命中已存在）；False = 失败（已 log.warning，不含 api_key）。
    """
    # lazy import：service.py 顶部不 import 本模块（set_default 用函数内 lazy import 调本函数），
    # 本模块顶部 import service 会构成循环；故 _strip_openai_suffix 复用走函数内导入。
    from app.modules.llm_provider.service import LlmProviderService

    settings = get_settings()
    model_name = litellm_model_name(user_id, provider.id)
    api_key_plain = cipher.decrypt(provider.encrypted_api_key, provider.key_id)
    api_base = LlmProviderService._strip_openai_suffix(provider.base_url or "")
    # spike-litellm-routing 第 2 项实测（2026-08-09）：LiteLLM **不接受 provider 独立字段**，要求
    # litellm_params.model 带 provider 前缀（``openai/<model>``）。原纯名+provider 字段实现会导致
    # POST /model/new 返 200（DB 写入成功）但 router upsert 持续失败 "LLM Provider NOT provided"，
    # deployment 被 drop 不进路由表 → 所有请求 not found + 容器 unhealthy。model 缺失兜底 gpt-3.5-turbo。
    raw_model = provider.model or "gpt-3.5-turbo"
    model_value = raw_model if "/" in raw_model else f"openai/{raw_model}"
    # gap-A 二次诊断（2026-08-10）实测定稿：litellm 1.95.0 对 openai 上游默认走 Responses API
    # （调 opencode /responses 返 object="response" 格式），openai adapter 期望 chat completions →
    # 解析失败 OpenAIException + 重试超时。原假设的 use_responses_api:false 字段在 1.95.0 源码中
    # **不存在**（grep 全源码 0 命中），是无操作字段。真正生效的杠杆是显式 ``model_info.mode=chat``
    # （POST /model/new body 顶层字段，非 litellm_params 内）：强制 Chat Completions 路径。实测矩阵
    # （mode=chat 单 deployment）：/v1/chat/completions 流式+非流式 × 纯文本+tools 全 ✅（tools 返
    # 标准 tool_calls）；/v1/messages **流式**纯文本+tools 全 ✅（含 tool_use block，Claude Code 路径）。
    # 唯一遗留：litellm 1.95.0 非流式 /v1/messages 仍走 responses bridge（上游 quirk），Claude Code
    # 默认流式不受影响。
    body = {
        "model_name": model_name,
        "litellm_params": {
            "model": model_value,
            "api_base": api_base,
            "api_key": api_key_plain,
        },
        "model_info": {"mode": "chat"},
    }
    headers = {"Authorization": f"Bearer {settings.litellm_master_key}"}
    try:
        async with httpx.AsyncClient(timeout=_LITELLM_TIMEOUT) as client:
            resp = await client.post(
                f"{settings.litellm_base_url}/model/new",
                json=body,
                headers=headers,
            )
    except Exception as exc:
        # best-effort（R-09）：网络/连接异常不抛，返回 False。不记 api_key（R-02）。
        log.warning("litellm.register_error", model_name=model_name, error=str(exc))
        return False
    # spike-litellm-routing 实测（2026-08-09）：重复 POST /model/new 同 model_name 返回 200
    # 创建**新 deployment**（非 400/409 "Already present"），LiteLLM 按 model_name 路由时多
    # deployment 同上游轮询（simple-shuffle）功能无害。200/201 = 成功；400/409 分支保留作防御
    # （未来 LiteLLM 版本可能改幂等语义），两者都视成功保证 set-default 可重试幂等。
    if resp.status_code in (200, 201):
        return True
    if resp.status_code in (400, 409):
        log.info(
            "litellm.register_idempotent",
            model_name=model_name,
            status=resp.status_code,
        )
        return True
    log.warning(
        "litellm.register_failed",
        model_name=model_name,
        status=resp.status_code,
    )
    return False


async def unregister(model_name: str) -> None:
    """从 LiteLLM admin API 注销所有 model_name 匹配的 deployment（best-effort，R-09 异常静默）。

    spike-litellm-routing 实测（2026-08-09）推翻原假设：
    - POST /model/delete 的 ``id`` 期望 **model_id（uuid）**，不是 model_name（传 model_name
      返 400 "Model with id=<name> not found in db"）；
    - 重复 POST /model/new 同 model_name 会创建多个 deployment（不同 model_id），故需删所有匹配；
    - GET /model/info 返回 ``data[].model_info.id``（model_id）+ ``data[].model_name``。

    流程：GET /model/info → 过滤 model_name 匹配的 model_id 列表 → 逐个 POST /model/delete
    {id: model_id}。全程 best-effort：GET 失败 / 无匹配 / 单个 delete 失败均静默（仅 log.warning，
    不阻塞 unset/delete provider 主流程）。model_id 不持久化到 backend（运行时查 LiteLLM），
    故 unregister 不需 provider 行额外字段。
    """
    settings = get_settings()
    headers = {"Authorization": f"Bearer {settings.litellm_master_key}"}
    base = settings.litellm_base_url
    try:
        async with httpx.AsyncClient(timeout=_LITELLM_TIMEOUT) as client:
            # 1. GET /model/info 找所有 model_name 匹配的 model_id（含重复注册累积的多 deployment）。
            model_ids: list[str] = []
            try:
                resp = await client.get(f"{base}/model/info", headers=headers)
            except Exception as exc:
                log.warning("litellm.unregister_list_error", model_name=model_name, error=str(exc))
                return  # GET 失败 → 不删（best-effort，避免在不确定状态下误操作）
            if resp.status_code == 200:
                data = (resp.json() or {}).get("data") or []
                for m in data:
                    info = m.get("model_info") if isinstance(m, dict) else None
                    if (
                        m.get("model_name") == model_name
                        and isinstance(info, dict)
                        and info.get("id")
                    ):
                        model_ids.append(info["id"])
            else:
                log.warning(
                    "litellm.unregister_list_failed",
                    model_name=model_name,
                    status=resp.status_code,
                )
                return  # GET 非 200 → 不删（避免误操作）
            # 2. 逐个 POST /model/delete {id: model_id}（单个失败不阻塞其余，R-09 best-effort）。
            for mid in model_ids:
                try:
                    await client.post(
                        f"{base}/model/delete",
                        json={"id": mid},
                        headers=headers,
                    )
                except Exception as exc:
                    log.warning("litellm.unregister_delete_error", model_id=mid, error=str(exc))
    except Exception as exc:
        log.warning("litellm.unregister_error", model_name=model_name, error=str(exc))
