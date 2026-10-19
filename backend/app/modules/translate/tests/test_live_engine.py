"""真模型端到端验证（env 门控，默认跳过——CI/无模型环境零成本）。

运行方式（2026-10-19 真机验证实证）：

    TRANSLATE_LIVE_TEST=1 python -m pytest app/modules/translate/tests/test_live_engine.py -v -s
    # 国内直连被墙环境加：HF_ENDPOINT=https://hf-mirror.com（模型缓存后仍走 etag 校验）

覆盖（2026-10-19-thinking-zh-translate 验证轮新增）：
- worker 子进程真模型推理：en→zh 译文含 CJK、无 EOS 缺失导致的重复循环乱码
  （回归锚：add_source_eos=false 协议下 spm 路径必须手动追加 </s>）；
- POST /api/translate/thinking 端点全链路（真引擎无 mock）：engine_ready=true、
  译文 translated=true、围栏代码块与 URL 保护段原样保留。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from app.modules.translate.engine import reset_translator_for_tests
from app.modules.translate.service import reset_cache_for_tests

pytestmark = pytest.mark.skipif(
    os.environ.get("TRANSLATE_LIVE_TEST") != "1",
    reason="live model test gated by TRANSLATE_LIVE_TEST=1 (loads real ct2 model)",
)

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
# 重复循环乱码特征：同一 2 字符片段连续重复 ≥8 次（EOS 缺失回归的指纹）
_REPEAT_RE = re.compile(r"(.{2})\1{7,}")

_EN_THINKING = (
    "The agent examines the repository structure, reads the existing module code, "
    "and decides to implement the feature by adding a new service function first."
)
_EN_WITH_CODE = "Run this first:\n```\nls -la\n```\nthen check https://example.com/x for details."


def _model_spec() -> str:
    from app.core.config import get_settings

    settings = get_settings()
    return settings.translate_model_dir or settings.translate_model_repo


@pytest.fixture(autouse=True)
def _reset_engine_state():
    reset_translator_for_tests()
    reset_cache_for_tests()
    yield
    reset_translator_for_tests()
    reset_cache_for_tests()


async def test_live_worker_subprocess_translates_cleanly() -> None:
    """worker 子进程 + 真模型：译文含中文、无重复循环乱码（EOS 协议回归锚）。"""
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.modules.translate.translate_worker", _model_spec(), "60"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        bufsize=1,
        cwd=str(Path(__file__).resolve().parents[4]),  # backend/（-m 需要 app 包可达）
    )
    try:
        req = {"id": 1, "op": "translate", "texts": [_EN_THINKING, _EN_WITH_CODE]}
        proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        proc.stdin.flush()
        resp = json.loads(proc.stdout.readline())
    finally:
        proc.stdin.close() if proc.stdin else None
        proc.terminate()
        proc.wait(timeout=10)
    assert resp.get("ok") is True, resp
    translations = resp["translations"]
    assert len(translations) == 2
    for out in translations:
        assert _CJK_RE.search(out), f"译文无中文: {out!r}"
        assert not _REPEAT_RE.search(out), f"重复循环乱码（EOS 回归）: {out[:80]!r}"


async def test_live_endpoint_full_chain(client, auth_headers) -> None:
    """POST /api/translate/thinking 真引擎全链路：保护段原样 + 译文中文。"""
    resp = await client.post(
        "/api/translate/thinking",
        json={"items": [{"id": "a", "text": _EN_THINKING}, {"id": "b", "text": _EN_WITH_CODE}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["engine_ready"] is True, body.get("reason")
    items = {i["id"]: i for i in body["items"]}
    assert items["a"]["translated"] is True
    assert _CJK_RE.search(items["a"]["text"])
    assert not _REPEAT_RE.search(items["a"]["text"])
    # 保护语义：围栏代码块与 URL 原样保留在译文里
    assert "```\nls -la\n```" in items["b"]["text"]
    assert "https://example.com/x" in items["b"]["text"]
    assert items["b"]["translated"] is True
