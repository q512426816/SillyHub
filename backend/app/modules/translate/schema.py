"""POST /api/translate/thinking 请求/响应 DTO 与限额常量。

限额口径（design 接口契约）：items ≤16 条/请求、单条 ≤20000 字符（与后端
思考块封顶 20000 同源，sdk_pipeline.py:481）、总字符 ≤80000。超限 422 由
pydantic Field 约束直接给出。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# 单条文本上限：对齐 sdk_pipeline 思考块封顶（20000 字符），再翻没有意义。
ITEM_MAX_CHARS = 20_000
# 单请求条数上限：前端合批粒度（16）即此值——防一次请求撑爆 worker 批推理。
ITEMS_MAX_COUNT = 16
# 单请求总字符上限：批推理时长帽（int8 CPU 上数秒级）。
REQUEST_MAX_TOTAL_CHARS = 80_000


class TranslateItemIn(BaseModel):
    """单条待翻文本。id 由客户端生成（stable，响应原样带回配对）。"""

    id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=ITEM_MAX_CHARS)


class TranslateRequest(BaseModel):
    """批量翻译请求。target 固定 zh（本变更唯一目标语言，扩语言时再放开）。"""

    items: list[TranslateItemIn] = Field(min_length=1, max_length=ITEMS_MAX_COUNT)
    target: Literal["zh"] = "zh"

    @model_validator(mode="after")
    def _check_total_chars(self) -> "TranslateRequest":
        total = sum(len(item.text) for item in self.items)
        if total > REQUEST_MAX_TOTAL_CHARS:
            raise ValueError(f"请求总字符超限：{total} > {REQUEST_MAX_TOTAL_CHARS}，请分批请求")
        return self


class TranslateItemOut(BaseModel):
    """单条翻译结果。translated=false 表示原文透传（不值得翻/引擎不可用）。"""

    id: str
    text: str
    translated: bool


class TranslateResponse(BaseModel):
    """fail-soft 契约：engine_ready=false 时 items 原文透传，HTTP 仍 200。"""

    ok: bool = True
    engine_ready: bool
    reason: str | None = None
    items: list[TranslateItemOut]
