"""翻译前文本处理（纯函数，零外部依赖）。

三件事：

1. **保护切分** ``split_protected``：围栏代码块（```…```）、行内代码（`…`）、
   URL 不送翻原样保留——agent 思考里全是代码与路径，送翻必破坏。未闭合
   围栏（流式截断形态）不匹配保护、内容按正文送翻（fail-open，半截代码
   翻坏不致命；闭合后自然恢复保护）。
2. **值得翻判定** ``is_translation_worthy``：中文为主（CJK 占比 ≥0.6）或过短
   （压平 <30 字符）或拉丁字母太少（<8 个）跳过——与前端
   ``lib/thinking-translate.ts needsTranslation`` 同规则双判定（前端跳过
   直接不发请求，后端兜底防穿透）。
3. **分块** ``split_translatable``：自然段优先、超长段按句界二次切，块
   ≤max_chars（默认 1000——opus-mt 位置编码 512 token，英文 ~4 字符/token
   留安全余量）。块拼接恒等于原文（reassembly 保真）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# 保护模式：围栏代码（多行）| 行内代码（不跨行）| URL。交替单遍扫描。
_PROTECT_RE = re.compile(
    r"```.*?```"  # fenced code block（DOTALL 跨行，懒惰配对）
    r"|`[^`\n]+`"  # inline code
    r"|https?://[^\s`]+"  # http(s) URL（止于空白/反引号）
    r"|www\.[^\s`]+",  # 裸 www
    re.DOTALL,
)

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")

# 值得翻判定阈值（与前端 lib/thinking-translate.ts 常量同源，改动须双侧同步）。
WORTHY_MIN_FLAT_CHARS = 30
WORTHY_MIN_LATIN_CHARS = 8
WORTHY_CJK_RATIO_MAX = 0.6

# 分块粒度（opus-mt 512 token 位置编码的安全字符预算）。
CHUNK_MAX_CHARS = 1000

# 句界切分：句末标点后的空白（空白归属下一块开头）。
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True, slots=True)
class SourceSegment:
    """一段原文切片：translatable=True 送翻，False 原样保留（代码/URL）。"""

    text: str
    translatable: bool


def split_protected(text: str) -> list[SourceSegment]:
    """按保护模式切分为交替的正文/保护段。

    空白归属：保护段之间的正文（含其前后空白）整体送翻由模型消化；保护段
    精确原样输出。纯保护内容（整段是代码块）→ 单个非翻译段。
    """
    out: list[SourceSegment] = []
    pos = 0
    for m in _PROTECT_RE.finditer(text):
        if m.start() > pos:
            out.append(SourceSegment(text[pos : m.start()], True))
        out.append(SourceSegment(m.group(0), False))
        pos = m.end()
    if pos < len(text):
        out.append(SourceSegment(text[pos:], True))
    # 合并相邻同类型段（regex 不产生，防御性保持不变量）
    merged: list[SourceSegment] = []
    for seg in out:
        if merged and merged[-1].translatable == seg.translatable:
            merged[-1] = SourceSegment(merged[-1].text + seg.text, seg.translatable)
        else:
            merged.append(seg)
    return merged


def is_translation_worthy(text: str) -> bool:
    """是否值得送翻：英文为主且够长才翻；中文为主/过短/几乎无拉丁字母跳过。"""
    flat = re.sub(r"\s+", " ", text).strip()
    if len(flat) < WORTHY_MIN_FLAT_CHARS:
        return False
    cjk = len(_CJK_RE.findall(flat))
    latin = len(_LATIN_RE.findall(flat))
    denom = cjk + latin
    if denom == 0:
        return False
    if cjk / denom >= WORTHY_CJK_RATIO_MAX:
        return False
    return latin >= WORTHY_MIN_LATIN_CHARS


def split_translatable(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    """把一段送翻正文切为 ≤max_chars 的块，拼接恒等于原文。

    段（\n\n+）优先（分隔符归上一段尾部保保真）；段内超限按句界（.!? 后
    空白，空白归上一句）二切；单句仍超限硬切。最后保序贪心合并填满预算
    （减少块数=减少推理批次）。
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    def _emit(pieces: list[str], s: str) -> None:
        while len(s) > max_chars:  # 单句仍超限：硬切
            pieces.append(s[:max_chars])
            s = s[max_chars:]
        if s:
            pieces.append(s)

    # 段切分：捕获分隔符并归上一段（join 逐字符还原的保真关键）
    parts = re.split(r"(\n\n+)", text)
    paragraphs = [
        parts[i] + (parts[i + 1] if i + 1 < len(parts) else "") for i in range(0, len(parts), 2)
    ]
    pieces: list[str] = []
    for para in paragraphs:
        if len(para) <= max_chars:
            pieces.append(para)
            continue
        # 句段列表（句末空白归上一句保真），先硬切超长单句再贪心装箱
        sentences: list[str] = []
        prev = 0
        for m in _SENTENCE_SPLIT_RE.finditer(para):
            sentences.append(para[prev : m.end()])
            prev = m.end()
        sentences.append(para[prev:])
        packed_para: list[str] = []
        for sent in sentences:
            if len(sent) > max_chars:
                _emit(packed_para, sent)
                continue
            if packed_para and len(packed_para[-1]) + len(sent) <= max_chars:
                packed_para[-1] += sent
            else:
                packed_para.append(sent)
        pieces.extend(packed_para)
    # 保序贪心合并
    packed: list[str] = []
    for piece in pieces:
        if packed and len(packed[-1]) + len(piece) <= max_chars:
            packed[-1] += piece
        else:
            packed.append(piece)
    total = sum(len(p) for p in packed)
    assert total == len(text), f"reassembly mismatch: {total} != {len(text)}"
    return packed


def collect_chunks(segments: list[SourceSegment]) -> list[str]:
    """从切分结果抽取全部送翻块（供批量送模型）。"""
    chunks: list[str] = []
    for seg in segments:
        if seg.translatable:
            chunks.extend(split_translatable(seg.text))
    return chunks
