"""用量查询各家硬编码 handler（task-02 / D-003）。

照 cc-switch ``balance.rs`` / ``coding_plan.rs`` 逐家抄准精确字段。本文件只负责
「请求 + 解析」，返回 ``list[UsageData]``（多窗口 tier）；不做错误两态分类、不做
SSRF、不做 api_key 解密、不做 detect_provider 路由（均在 task-03 service 层）。

handler 签名统一 ``async def query_xxx(client, base_url, api_key) -> list[UsageData]``：
- ``client``：task-03 注入的 ``httpx.AsyncClient``（已配 15s 超时）；
- ``base_url``：供应商 base_url（handler 只取 ``scheme://host`` 拼各家固定用量端点路径，
  兼容 .cn/.com 与 bigmodel/z.ai 变体，不依赖用户 base 的子路径如 /anthropic）；
- ``api_key``：明文 key（task-03 解密注入，本文件永不 log 它）。

错误传导（交 task-03 分类，本层不判两态）：
- ``httpx`` 请求异常（超时 / 连接拒绝 / 读体中断）→ 直接 raise → task-03 归瞬时（5xx）；
- 非 2xx → raise :class:`UsageUpstreamError`（带 status）→ task-03 按 status 分类
  （401/403→确定性鉴权失败；429/5xx→瞬时；其它 4xx→确定性）；
- 2xx 但 body 非法 JSON / 业务级错误（智谱 success:false / MiniMax base_resp 非 0）
  → raise ``UsageUpstreamError(status_code=None)`` → 确定性。

tier 表达：balance 三家回绝对额（total/used/remaining=金额，unit=USD/CNY）；
token_plan 四家回百分比（total=100 / used=utilization / remaining=100-utilization /
unit="%"，重置时间 ISO8601 放 extra）。解析层忠搬运负数 / 超 100 值不裁剪（照 cc-switch，
裁剪归前端渲染层）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlparse

import httpx

from app.modules.llm_provider.schema import UsageData


class UsageUpstreamError(Exception):
    """上游非 2xx / body 不可解析 / 业务级错误（交 task-03 按两态分类）。

    ``status_code`` 为 ``None`` 表示 2xx 但 body 非法或业务级错误（确定性）。
    ``body`` 仅用于调试 / 日志，**不得**直接回传前端（可能含上游回显，task-03 用安全文案）。
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        body: str = "",
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


# ── 工具函数 ──────────────────────────────────────────────────────────────────


def _origin(base_url: str) -> str:
    """取 base_url 的 ``https://host``（忽略子路径，兼容用户 base 带 /anthropic 等）。"""
    url = (base_url or "").strip()
    if "://" not in url:
        url = "https://" + url
    host = (urlparse(url).hostname or "").lower()
    return f"https://{host}"


def _host(base_url: str) -> str:
    """base_url 的 host（小写），用于 .cn/.com 变体判定。"""
    return urlparse(_origin(base_url)).hostname or ""


def _parse_float(value: object) -> float | None:
    """解析数字或数字字符串为 float（照 cc-switch ``parse_f64``）。"""
    if isinstance(value, bool):  # bool 是 int 子类，先排除
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _millis_to_iso(ms: int) -> str | None:
    """毫秒时间戳 → ISO8601（UTC）。"""
    try:
        return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat()
    except (OSError, ValueError, OverflowError):
        return None


def _extract_reset_time(value: object) -> str | None:
    """重置时间：字符串（ISO）原样返回；整数按秒/毫秒转 ISO8601；<=0 / None → None。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        return value or None
    if isinstance(value, int):
        if value <= 0:
            return None
        ms = value * 1000 if value < 1_000_000_000_000 else value
        return _millis_to_iso(ms)
    return None


def _percentage_tier(name: str, utilization: float, resets_at: str | None) -> UsageData:
    """token_plan 百分比 tier：total=100 / used=utilization / remaining=100-utilization / unit='%'。"""
    return UsageData(
        plan_name=name,
        total=100.0,
        used=utilization,
        remaining=100.0 - utilization,
        unit="%",
        extra=resets_at,
        is_valid=True,
    )


async def _get_json(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
) -> object:
    """GET + 读体 + 解析 JSON。非 2xx / 解析失败 → :class:`UsageUpstreamError`。

    httpx 默认在 ``client.get`` 返回前已缓冲完整响应体，故读体中断会以 ``httpx`` 异常
    形式在 ``client.get`` 抛出（交 task-03 归瞬时）；拿到完整 body 后解析失败才是确定性。
    """
    resp = await client.get(url, headers=headers)
    if not (200 <= resp.status_code < 300):
        raise UsageUpstreamError(
            f"upstream HTTP {resp.status_code}",
            status_code=resp.status_code,
            body=resp.text,
        )
    try:
        return resp.json()
    except ValueError as exc:
        raise UsageUpstreamError(
            f"failed to parse response: {exc}",
            status_code=None,
            body=resp.text,
        ) from exc


# ── balance 路径（账户余额，绝对额）──────────────────────────────────────────


async def query_deepseek(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
) -> list[UsageData]:
    """DeepSeek ``GET /user/balance``（照 balance.rs:74-146）。

    Response: ``{ balance_infos: [{ currency, total_balance, ... }], is_available }``。
    多币种多 tier；remaining=total_balance，unit=currency（缺省 CNY）。
    """
    url = f"{_origin(base_url)}/user/balance"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    body = await _get_json(client, url, headers)
    if not isinstance(body, dict):
        raise UsageUpstreamError("deepseek: response is not an object", status_code=None)

    is_available = body.get("is_available")
    is_available = is_available if isinstance(is_available, bool) else True

    tiers: list[UsageData] = []
    infos = body.get("balance_infos")
    if isinstance(infos, list):
        for info in infos:
            if not isinstance(info, dict):
                continue
            currency = info.get("currency")
            currency = currency if isinstance(currency, str) and currency else "CNY"
            total = _parse_float(info.get("total_balance"))
            tiers.append(
                UsageData(
                    plan_name=currency,
                    remaining=total,
                    total=None,
                    used=None,
                    unit=currency,
                    is_valid=is_available,
                    invalid_message=None if is_available else "余额不足",
                    extra=None,
                )
            )
    return tiers


async def query_siliconflow(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
) -> list[UsageData]:
    """硅基流动 ``GET /v1/user/info``（.cn→CNY / .com→USD，照 balance.rs:210-281）。

    Response: ``{ data: { totalBalance, ... } }``；remaining=totalBalance。
    """
    is_cn = ".cn" in _host(base_url)  # api.siliconflow.cn vs api.siliconflow.com
    url = f"{_origin(base_url)}/v1/user/info"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    body = await _get_json(client, url, headers)
    if not isinstance(body, dict):
        raise UsageUpstreamError("siliconflow: response is not an object", status_code=None)

    data = body.get("data")
    if not isinstance(data, dict):
        raise UsageUpstreamError(
            "siliconflow: missing 'data' field",
            status_code=None,
        )
    total_balance = _parse_float(data.get("totalBalance")) or 0.0
    unit = "CNY" if is_cn else "USD"
    name = "硅基流动" if is_cn else "硅基流动(国际)"
    return [
        UsageData(
            plan_name=name,
            remaining=total_balance,
            total=None,
            used=None,
            unit=unit,
            is_valid=True,
            extra=None,
        )
    ]


async def query_openrouter(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
) -> list[UsageData]:
    """OpenRouter ``GET /api/v1/credits``（照 balance.rs:287-346）。

    Response: ``{ data: { total_credits, total_usage } }``；remaining=total_credits-total_usage。
    """
    url = f"{_origin(base_url)}/api/v1/credits"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    body = await _get_json(client, url, headers)
    if not isinstance(body, dict):
        raise UsageUpstreamError("openrouter: response is not an object", status_code=None)

    raw_data = body.get("data")
    data = raw_data if isinstance(raw_data, dict) else body
    total_credits = _parse_float(data.get("total_credits")) or 0.0
    total_usage = _parse_float(data.get("total_usage")) or 0.0
    remaining = total_credits - total_usage
    return [
        UsageData(
            plan_name="OpenRouter",
            remaining=remaining,
            total=total_credits,
            used=total_usage,
            unit="USD",
            is_valid=remaining > 0,
            invalid_message=None if remaining > 0 else "无剩余额度",
            extra=None,
        )
    ]


# ── token_plan 路径（编程套餐额度，百分比）────────────────────────────────────


async def query_kimi(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
) -> list[UsageData]:
    """Kimi / Kimi For Coding ``GET /coding/v1/usages``（照 coding_plan.rs:102-206）。

    Kimi 与 Kimi For Coding 同 api.kimi.com 走 /coding 子路径，共用本 handler（detect
    在 task-03）。Response: ``{ limits: [{ detail: { limit, remaining, resetTime } }],
    usage: { limit, remaining, resetTime } }``。limits→5小时窗，usage→周限额；回绝对值
    limit/remaining，利用率=(limit-remaining)/limit*100。
    """
    url = f"{_origin(base_url)}/coding/v1/usages"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    body = await _get_json(client, url, headers)
    if not isinstance(body, dict):
        raise UsageUpstreamError("kimi: response is not an object", status_code=None)

    tiers: list[UsageData] = []

    # 5 小时窗口限额（limits[].detail）
    limits = body.get("limits")
    if isinstance(limits, list):
        for limit_item in limits:
            if not isinstance(limit_item, dict):
                continue
            detail = limit_item.get("detail")
            if not isinstance(detail, dict):
                continue
            limit = _parse_float(detail.get("limit")) or 1.0
            remaining = _parse_float(detail.get("remaining")) or 0.0
            resets_at = _extract_reset_time(detail.get("resetTime"))
            used = max(limit - remaining, 0.0)
            utilization = (used / limit * 100.0) if limit > 0 else 0.0
            tiers.append(_percentage_tier("5小时窗", utilization, resets_at))

    # 总体用量（周限额）
    usage = body.get("usage")
    if isinstance(usage, dict):
        limit = _parse_float(usage.get("limit")) or 1.0
        remaining = _parse_float(usage.get("remaining")) or 0.0
        resets_at = _extract_reset_time(usage.get("resetTime"))
        used = max(limit - remaining, 0.0)
        utilization = (used / limit * 100.0) if limit > 0 else 0.0
        tiers.append(_percentage_tier("周限额", utilization, resets_at))

    return tiers


def _classify_zhipu_window(item: dict) -> str | None:
    """按 ``unit`` 字段判定智谱 TOKENS_LIMIT 条目所属窗口（照 coding_plan.rs:224-230）。

    unit 3→5 小时窗；unit 6→周限额；其余 / 缺失→None（走重置时间兜底）。
    """
    unit = item.get("unit")
    if isinstance(unit, bool) or not isinstance(unit, int):
        return None
    if unit == 3:
        return "five_hour"
    if unit == 6:
        return "weekly"
    return None


def _parse_zhipu_tiers(data: dict) -> list[UsageData]:
    """解析智谱 ``data.limits[]`` 中 type==TOKENS_LIMIT 条目为 tier 列表。

    分类优先级（照 coding_plan.rs:244-298）：显式 ``unit`` 标窗口类型 > 兜底按
    ``nextResetTime`` 升序填入仍空缺的槽位（无 reset 的优先 five_hour）。最多两条。
    老套餐仅一条 TOKENS_LIMIT → 自然降级仅 five_hour。
    """
    five_hour: tuple[int | None, float, str | None] | None = None
    weekly: tuple[int | None, float, str | None] | None = None
    unclassified: list[tuple[int | None, float, str | None]] = []

    limits = data.get("limits")
    if isinstance(limits, list):
        for limit_item in limits:
            if not isinstance(limit_item, dict):
                continue
            limit_type = limit_item.get("type")
            # 大小写不敏感：上游若改成小写/驼峰仍能识别
            if not (isinstance(limit_type, str) and limit_type.upper() == "TOKENS_LIMIT"):
                continue
            percentage = _parse_float(limit_item.get("percentage"))
            percentage = 0.0 if percentage is None else percentage
            reset_raw = limit_item.get("nextResetTime")
            reset_ms = (
                reset_raw
                if isinstance(reset_raw, int) and not isinstance(reset_raw, bool)
                else None
            )
            reset_iso = _millis_to_iso(reset_ms) if reset_ms is not None else None
            entry: tuple[int | None, float, str | None] = (reset_ms, percentage, reset_iso)
            window = _classify_zhipu_window(limit_item)
            if window == "five_hour" and five_hour is None:
                five_hour = entry
            elif window == "weekly" and weekly is None:
                weekly = entry
            else:
                unclassified.append(entry)

    # 兜底：按 (有无 reset, reset 值) 升序，依次填入仍空缺的 five_hour / weekly 槽位
    unclassified.sort(
        key=lambda e: (e[0] is not None, e[0] if e[0] is not None else -9223372036854775808)
    )
    for entry in unclassified:
        if five_hour is None:
            five_hour = entry
        elif weekly is None:
            weekly = entry
        # 智谱当前最多两条 TOKENS_LIMIT，多余的忽略

    tiers: list[UsageData] = []
    for name, slot in (("5小时窗", five_hour), ("周限额", weekly)):
        if slot is not None:
            tiers.append(_percentage_tier(name, slot[1], slot[2]))
    return tiers


async def query_zhipu(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
) -> list[UsageData]:
    """智谱 GLM ``GET /api/monitor/usage/quota/limit``（照 coding_plan.rs:316-406）。

    ⚠️ 真实端点是 ``/api/monitor/usage/quota/limit``（design §5 写的
    ``/api/paas/v4/coding-plan/quota`` 有误，以 cc-switch 源码为准）。Authorization 头
    **不加 Bearer 前缀**（裸 key）。Response: ``{ success, data: { level, limits: [...] } }``。
    percentage 已是 0-100 直接作利用率；按 unit 分 5h/周窗。
    """
    url = f"{_origin(base_url)}/api/monitor/usage/quota/limit"
    headers = {
        "Authorization": api_key,  # 智谱不加 Bearer 前缀（裸 key）
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en",
    }
    body = await _get_json(client, url, headers)
    if not isinstance(body, dict):
        raise UsageUpstreamError("zhipu: response is not an object", status_code=None)

    if body.get("success") is False:
        msg = body.get("msg")
        msg = msg if isinstance(msg, str) else "unknown error"
        raise UsageUpstreamError(f"zhipu business error: {msg}", status_code=None)

    data = body.get("data")
    if not isinstance(data, dict):
        raise UsageUpstreamError("zhipu: missing 'data' field", status_code=None)

    level = data.get("level")
    level = level if isinstance(level, str) and level else None
    tiers = _parse_zhipu_tiers(data)
    if level:  # 套餐等级并入 plan_name 前缀（如「Max·5小时窗」）
        for tier in tiers:
            tier.plan_name = f"{level}·{tier.plan_name}"
    return tiers


def _parse_minimax_tiers(body: dict) -> list[UsageData]:
    """解析 MiniMax ``/coding_plan/remains``（照 coding_plan.rs:639-695）。

    新接口给「剩余百分比」（0-100），反转为已用百分比。``model_remains[]`` 取
    ``model_name=="general"``（跳过 video）；5h 桶始终取，周桶仅当
    ``current_weekly_status==1`` 才激活（status=3 等表示无周限额，恒 100，不展示）。
    """
    model_remains = body.get("model_remains")
    if not isinstance(model_remains, list):
        return []
    item: dict | None = None
    for it in model_remains:
        if isinstance(it, dict) and it.get("model_name") == "general":
            item = it
            break
    if item is None:
        return []

    tiers: list[UsageData] = []
    # 5h 桶
    remain_5h = _parse_float(item.get("current_interval_remaining_percent"))
    if remain_5h is not None:
        end_time = item.get("end_time")
        resets_at = (
            _millis_to_iso(end_time)
            if isinstance(end_time, int) and not isinstance(end_time, bool)
            else None
        )
        tiers.append(_percentage_tier("5小时窗", 100.0 - remain_5h, resets_at))

    # 周桶：仅当 status==1 激活
    weekly_status = item.get("current_weekly_status")
    if (
        isinstance(weekly_status, int)
        and not isinstance(weekly_status, bool)
        and weekly_status == 1
    ):
        remain_weekly = _parse_float(item.get("current_weekly_remaining_percent"))
        if remain_weekly is not None:
            weekly_end = item.get("weekly_end_time")
            resets_at = (
                _millis_to_iso(weekly_end)
                if isinstance(weekly_end, int) and not isinstance(weekly_end, bool)
                else None
            )
            tiers.append(_percentage_tier("周限额", 100.0 - remain_weekly, resets_at))
    return tiers


async def query_minimax(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
) -> list[UsageData]:
    """MiniMax ``GET /v1/api/openplatform/coding_plan/remains``（.com.cn / .io，照 coding_plan.rs:410-491）。

    先查 ``base_resp.status_code!=0`` 报业务错；再解析 general 桶。
    """
    url = f"{_origin(base_url)}/v1/api/openplatform/coding_plan/remains"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = await _get_json(client, url, headers)
    if not isinstance(body, dict):
        raise UsageUpstreamError("minimax: response is not an object", status_code=None)

    base_resp = body.get("base_resp")
    if isinstance(base_resp, dict):
        status_code = base_resp.get("status_code")
        if isinstance(status_code, int) and not isinstance(status_code, bool) and status_code != 0:
            msg = base_resp.get("status_msg")
            msg = msg if isinstance(msg, str) else "unknown error"
            raise UsageUpstreamError(
                f"minimax business error (code {status_code}): {msg}",
                status_code=None,
            )
    return _parse_minimax_tiers(body)
