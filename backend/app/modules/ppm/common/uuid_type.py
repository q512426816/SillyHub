"""UUID 列类型 — 兼容 str / uuid.UUID 输入的 Uuid 包装。

背景:``sqlalchemy.Uuid(as_uuid=True)`` 的 bind processor 要求传入
``uuid.UUID`` 对象,传 ``str`` 会抛 ``AttributeError: 'str' object has no
attribute 'hex'``。但 ppm 子域的 API 入口 (Pydantic schema) 和历史代码
均以 ``str`` 形式承载 UUID,SQLModel table=True 模型 init 也不做运行时
coerce。本类型在 bind 阶段把 ``str`` / ``bytes`` 容错转成 ``uuid.UUID``,
非法值降级为 ``NULL`` (与 migration 202607220900 对脏值的处理一致),
从而让 model 字段从 ``String`` 切到 UUID 时无需同步重构所有调用方。

设计依据:CLAUDE.md「数据可清空」(§7) + migration 202607220900。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Uuid
from sqlalchemy.types import TypeDecorator


class UuidCoercing(TypeDecorator):
    """``Uuid(as_uuid=True)`` 的宽容版 — 接受 str/bytes/uuid.UUID 输入。

    - ``uuid.UUID`` 原值透传
    - 合法 UUID 字符串/bytes → ``uuid.UUID`` 转换
    - 非法值 (脏数据、逗号列表等) → ``None`` (落库 NULL,与迁移一致)
    - ``None`` → ``None``
    """

    impl = Uuid
    cache_ok = True

    def __init__(self, *, as_uuid: bool = True, native_uuid: bool = True) -> None:
        # as_uuid 强制为 True — 本类型语义就是返回 uuid.UUID (与 model 字段标注一致)。
        super().__init__(as_uuid=True, native_uuid=native_uuid)

    def process_bind_param(
        self,
        value: Any,
        dialect: Any,
    ) -> uuid.UUID | None:
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        if isinstance(value, (str, bytes)):
            try:
                return uuid.UUID(value)
            except (ValueError, AttributeError, TypeError):
                return None
        # 其他类型 (int 等) 尝试 UUID(int=...) 容错
        try:
            return uuid.UUID(str(value))
        except (ValueError, AttributeError, TypeError):
            return None


__all__ = ["UuidCoercing"]
