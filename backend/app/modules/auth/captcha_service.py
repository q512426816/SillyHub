"""登录保护:IP 限流 + 失败计数 + 点按式人机确认(原滑块验证码,体验差已下线)。

设计要点
========
- 全部状态走 Redis(复用 ``app.core.redis.get_redis``);Redis 故障时 best-effort
  降级为"放行"(不限流/不要求验证码)并记 warning——与 ``api_key_service`` 缓存
  降级哲学一致:Redis 是可靠依赖,挂了属运维事件,不让登录因此完全不可用。
- 限流:同一 IP 60s 窗口 INCR,超 ``auth_login_rate_limit_per_minute`` → 429。
- 失败计数:登录失败 INCR,达 ``auth_login_fail_threshold`` 后该 IP 登录必须带
  有效 captcha_token;登录成功清零。
- 人机确认:失败达阈值后,前端弹「我不是机器人」点按组件,点击即向后端取一次性
  captcha_id 并立刻校验换 captcha_token,登录时回传。token 一次性消费,防重放/爆破。
  防爆破主力是上面的 IP 限流 + 失败计数;点按确认只是把人机环节从"拖滑块对位置"
  (±6px 难对齐、体验差)简化为"点一下",安全语义不变(仍需一次后端往返取有效 token)。
"""

from __future__ import annotations

import secrets
import uuid

from app.core.config import Settings
from app.core.errors import LoginCaptchaRequired, LoginRateLimited
from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

_RATE_WINDOW = 60  # 限流窗口 = 60s(每分钟)


def _rate_key(ip: str) -> str:
    return f"login:rate:{ip}"


def _fail_key(ip: str) -> str:
    return f"login:fail:{ip}"


def _confirm_key(captcha_id: str) -> str:
    return f"captcha:confirm:{captcha_id}"


def _token_key(token: str) -> str:
    return f"captcha:token:{token}"


class CaptchaService:
    """登录限流 + 失败计数 + 滑块验证码。无状态(状态全在 Redis)。"""

    def __init__(self, *, settings: Settings) -> None:
        self._settings = settings

    # ── 限流 / 失败计数 ────────────────────────────────────────────────────

    async def check_rate_limit(self, ip: str | None) -> None:
        """同一 IP 60s 窗口超阈值 → LoginRateLimited。Redis 故障降级放行。"""
        if not ip:
            return
        try:
            redis = get_redis()
            key = _rate_key(ip)
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, _RATE_WINDOW)
            if count > self._settings.auth_login_rate_limit_per_minute:
                log.warning("login.rate_limited", ip=ip, count=count)
                raise LoginRateLimited(
                    "登录尝试过于频繁,请稍后再试。",
                    details={"retry_after": _RATE_WINDOW},
                )
        except LoginRateLimited:
            raise
        except Exception as exc:  # Redis 故障:降级放行,不阻断登录可用性
            log.warning("login.rate_limit_check_failed", ip=ip, error=str(exc))

    async def _failures(self, ip: str | None) -> int:
        if not ip:
            return 0
        try:
            raw = await get_redis().get(_fail_key(ip))
            return int(raw) if raw else 0
        except Exception:
            return 0

    async def record_login_failure(self, ip: str | None) -> int:
        """登录失败 +1,返回窗口内累计次数(首次设置过期)。"""
        if not ip:
            return 0
        try:
            redis = get_redis()
            key = _fail_key(ip)
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, self._settings.auth_login_fail_window_seconds)
            return count
        except Exception as exc:
            log.warning("login.fail_count_failed", ip=ip, error=str(exc))
            return 0

    async def clear_login_failures(self, ip: str | None) -> None:
        if not ip:
            return
        try:
            await get_redis().delete(_fail_key(ip))
        except Exception:
            pass

    async def needs_captcha(self, ip: str | None) -> bool:
        return await self._failures(ip) >= self._settings.auth_login_fail_threshold

    async def assert_captcha_if_needed(self, ip: str | None, captcha_token: str | None) -> bool:
        """需要验证码时校验 captcha_token(一次性消费)。

        返回值语义:
        - True:本次已通过人机验证(消费了有效 captcha_token);
        - False:当前无需验证码(needs_captcha 未达阈值);
        - 需要但缺失/无效 token → raise LoginCaptchaRequired。

        调用方据返回值决定密码错时如何反馈:captcha_verified=True 时密码错应正常抛
        AuthInvalidCredentials(明确提示密码错误),不再绕回"要验证码"——否则阈值触发后
        用户带有效 token 登录、密码仍错时,会陷入"验证→又让验证"循环(token 已被本方法
        一次性消费),永远看不到密码错误提示。
        """
        if not await self.needs_captcha(ip):
            return False
        if captcha_token and await self._consume_captcha_token(captcha_token):
            return True
        raise LoginCaptchaRequired(
            "登录失败次数过多,请完成滑块验证后重试。",
            details={"need_captcha": True},
        )

    # ── 点按式人机确认 ─────────────────────────────────────────────────────

    async def create_confirmation(self) -> dict[str, str]:
        """签发一次性 captcha_id(存 Redis),前端点「我不是机器人」时取。"""
        captcha_id = uuid.uuid4().hex
        try:
            await get_redis().set(
                _confirm_key(captcha_id),
                "1",
                ex=self._settings.auth_captcha_token_ttl_seconds,
            )
        except Exception as exc:
            # 存不下则 verify 取不到会失败,客户端重取即可
            log.warning("captcha.confirm_store_failed", captcha_id=captcha_id, error=str(exc))
        return {"captcha_id": captcha_id}

    async def verify_confirmation(self, captcha_id: str) -> str | None:
        """校验 captcha_id 有效(一次性消费)→ 签发一次性 captcha_token;无效返 None。"""
        try:
            redis = get_redis()
            key = _confirm_key(captcha_id)
            raw = await redis.get(key)
            if not raw:
                return None
            await redis.delete(key)  # 一次性
            token = secrets.token_urlsafe(24)
            await redis.set(
                _token_key(token),
                "1",
                ex=self._settings.auth_captcha_token_ttl_seconds,
            )
            return token
        except Exception as exc:
            log.warning("captcha.confirm_verify_failed", captcha_id=captcha_id, error=str(exc))
            return None

    async def _consume_captcha_token(self, token: str) -> bool:
        """登录消费 captcha_token(一次性 DEL,防同一 token 反复登录爆破)。"""
        try:
            redis = get_redis()
            key = _token_key(token)
            raw = await redis.get(key)
            if not raw:
                return False
            await redis.delete(key)
            return True
        except Exception:
            return False
