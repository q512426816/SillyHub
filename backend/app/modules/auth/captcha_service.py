"""登录保护:IP 限流 + 失败计数 + 滑块验证码。

设计要点
========
- 全部状态走 Redis(复用 ``app.core.redis.get_redis``);Redis 故障时 best-effort
  降级为"放行"(不限流/不要求验证码)并记 warning——与 ``api_key_service`` 缓存
  降级哲学一致:Redis 是可靠依赖,挂了属运维事件,不让登录因此完全不可用。
- 限流:同一 IP 60s 窗口 INCR,超 ``auth_login_rate_limit_per_minute`` → 429。
- 失败计数:登录失败 INCR,达 ``auth_login_fail_threshold`` 后该 IP 登录必须带
  有效 captcha_token;登录成功清零。
- 滑块:Pillow 生成背景图(渐变+噪点)+ 凹槽阴影 + 滑块块,target_x 仅存后端
  (不返回前端),前端据视觉拖动对齐,提交 x 后端校验 ``|x-target_x|≤容差``,
  通过签发一次性 captcha_token。slider 与 token 均一次性消费,防重放/爆破。
"""

from __future__ import annotations

import asyncio
import base64
import io
import secrets
import uuid

from PIL import Image, ImageDraw, ImageFilter

from app.core.config import Settings
from app.core.errors import LoginCaptchaRequired, LoginRateLimited
from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

# 滑块几何(常量;生产如需调整再提 config)
_BG_W, _BG_H = 300, 150
_GAP = 44  # 凹槽 / 滑块块边长(px)
# 凹槽 x 范围:左侧留出滑道空间,右侧留边
_TARGET_X_MIN, _TARGET_X_MAX = 80, _BG_W - _GAP - 20
_SLIDER_Y = (_BG_H - _GAP) // 2  # 凹槽/滑块块固定垂直居中(只 x 随机;前端块 CSS 居中自动对齐)
_POS_TOLERANCE = 6  # 拖动位置容差(px)

_RATE_WINDOW = 60  # 限流窗口 = 60s(每分钟)


def _rate_key(ip: str) -> str:
    return f"login:rate:{ip}"


def _fail_key(ip: str) -> str:
    return f"login:fail:{ip}"


def _slider_key(captcha_id: str) -> str:
    return f"captcha:slider:{captcha_id}"


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

    async def assert_captcha_if_needed(self, ip: str | None, captcha_token: str | None) -> None:
        """需要验证码时,校验 captcha_token(一次性消费);缺失/无效 → LoginCaptchaRequired。"""
        if not await self.needs_captcha(ip):
            return
        if captcha_token and await self._consume_captcha_token(captcha_token):
            return
        raise LoginCaptchaRequired(
            "登录失败次数过多,请完成滑块验证后重试。",
            details={"need_captcha": True},
        )

    # ── 滑块生成 / 校验 ────────────────────────────────────────────────────

    async def create_slider(self) -> dict[str, str]:
        """生成一组滑块图(背景含凹槽 + 滑块块),target_x 存 Redis(不返回)。"""
        captcha_id = uuid.uuid4().hex
        target_x = secrets.randbelow(_TARGET_X_MAX - _TARGET_X_MIN + 1) + _TARGET_X_MIN
        bg_b64, slider_b64 = await asyncio.to_thread(_render_slider_images, target_x)
        try:
            await get_redis().set(
                _slider_key(captcha_id),
                str(target_x),
                ex=self._settings.auth_captcha_token_ttl_seconds,
            )
        except Exception as exc:
            # 图已生成但存不下:verify 取不到会失败,客户端重取即可
            log.warning("captcha.slider_store_failed", captcha_id=captcha_id, error=str(exc))
        return {"captcha_id": captcha_id, "bg_image": bg_b64, "slider_image": slider_b64}

    async def verify_slider(self, captcha_id: str, x: int) -> str | None:
        """校验拖动位置 → 通过签发一次性 captcha_token;slider 无论对错都作废(防爆破 target)。"""
        try:
            redis = get_redis()
            key = _slider_key(captcha_id)
            raw = await redis.get(key)
            if not raw:
                return None
            await redis.delete(key)  # 一次性
            try:
                target_x = int(raw)
            except (TypeError, ValueError):
                return None
            if abs(x - target_x) <= _POS_TOLERANCE:
                token = secrets.token_urlsafe(24)
                await redis.set(
                    _token_key(token),
                    "1",
                    ex=self._settings.auth_captcha_token_ttl_seconds,
                )
                return token
            return None
        except Exception as exc:
            log.warning("captcha.slider_verify_failed", captcha_id=captcha_id, error=str(exc))
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


# ── Pillow 渲染(同步;由 asyncio.to_thread 调度,不阻塞事件循环)──────────


def _render_slider_images(target_x: int) -> tuple[str, str]:
    """返回 (背景图 data-URI, 滑块块 data-URI)。

    背景图 = 渐变+噪点底图 + 在缺口位置叠半透明凹槽(用户看见缺口);
    滑块块 = 从底图裁出缺口那块像素 + 白色描边(用户拖它对齐凹槽)。
    """
    target_y = _SLIDER_Y
    bg = _make_background()
    overlay = Image.new("RGBA", (_BG_W, _BG_H), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle(
        (target_x, target_y, target_x + _GAP, target_y + _GAP),
        fill=(0, 0, 0, 96),
        outline=(255, 255, 255, 200),
        width=1,
    )
    bg_with_gap = Image.alpha_composite(bg.convert("RGBA"), overlay)

    slider = bg.crop((target_x, target_y, target_x + _GAP, target_y + _GAP)).convert("RGBA")
    ImageDraw.Draw(slider).rectangle(
        (0, 0, _GAP - 1, _GAP - 1), outline=(255, 255, 255, 230), width=2
    )
    return _to_data_uri(bg_with_gap), _to_data_uri(slider)


def _make_background() -> Image.Image:
    """随机渐变背景 + 噪点干扰线(增加缺口位置 OCR 难度)。"""
    c1 = (
        secrets.randbelow(106) + 60,
        secrets.randbelow(106) + 60,
        secrets.randbelow(106) + 60,
    )
    c2 = (
        secrets.randbelow(106) + 100,
        secrets.randbelow(106) + 100,
        secrets.randbelow(106) + 100,
    )
    img = Image.new("RGB", (_BG_W, _BG_H), c1)
    draw = ImageDraw.Draw(img)
    for y in range(_BG_H):
        ratio = y / _BG_H
        draw.line(
            [(0, y), (_BG_W, y)],
            fill=(
                int(c1[0] + (c2[0] - c1[0]) * ratio),
                int(c1[1] + (c2[1] - c1[1]) * ratio),
                int(c1[2] + (c2[2] - c1[2]) * ratio),
            ),
        )
    for _ in range(8):  # 噪点干扰线
        gray = secrets.randbelow(256)
        draw.line(
            [
                (secrets.randbelow(_BG_W), secrets.randbelow(_BG_H)),
                (secrets.randbelow(_BG_W), secrets.randbelow(_BG_H)),
            ],
            fill=(gray, gray, gray),
            width=1,
        )
    return img.filter(ImageFilter.SMOOTH)


def _to_data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
