"""POST /api/translate/thinking HTTP 端点测试：鉴权 / 限额 422 / fail-soft。"""

from __future__ import annotations

import pytest

from app.modules.translate.schema import ITEM_MAX_CHARS, ITEMS_MAX_COUNT


@pytest.fixture(autouse=True)
def _reset_caches():
    from app.modules.translate.service import reset_cache_for_tests

    reset_cache_for_tests()
    yield
    reset_cache_for_tests()


async def test_translate_endpoint_requires_auth(client) -> None:
    resp = await client.post(
        "/api/translate/thinking", json={"items": [{"id": "a", "text": "hello"}]}
    )
    assert resp.status_code in (401, 403)


async def test_translate_endpoint_fail_soft_when_engine_missing(
    client, auth_headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.modules.translate.engine.get_translator", lambda spec: (None, "no model")
    )
    resp = await client.post(
        "/api/translate/thinking",
        json={"items": [{"id": "a", "text": "The agent is thinking about the next step."}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["engine_ready"] is False
    assert body["items"][0]["translated"] is False
    assert body["items"][0]["text"] == "The agent is thinking about the next step."


async def test_translate_endpoint_translates_with_fake_engine(
    client, auth_headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _Fake:
        def translate(self, texts: list[str]) -> list[str]:
            return [f"[译]{t}" for t in texts]

    monkeypatch.setattr("app.modules.translate.engine.get_translator", lambda spec: (_Fake(), None))
    resp = await client.post(
        "/api/translate/thinking",
        json={
            "items": [
                {"id": "a", "text": "First english thinking segment worth translating."},
                {"id": "b", "text": "这段中文为主的思考不需要翻译，直接透传。"},
            ]
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["engine_ready"] is True
    assert body["items"][0]["translated"] is True
    assert body["items"][0]["text"].startswith("[译]")
    assert body["items"][1]["translated"] is False


async def test_translate_endpoint_limit_rejections(client, auth_headers) -> None:
    # 条数超限 → 422
    too_many = {"items": [{"id": f"i{n}", "text": "x" * 40} for n in range(ITEMS_MAX_COUNT + 1)]}
    resp = await client.post("/api/translate/thinking", json=too_many, headers=auth_headers)
    assert resp.status_code == 422
    # 单条超长 → 422
    resp = await client.post(
        "/api/translate/thinking",
        json={"items": [{"id": "a", "text": "e" * (ITEM_MAX_CHARS + 1)}]},
        headers=auth_headers,
    )
    assert resp.status_code == 422
    # 总量超限（16 条 × 20000 字符中的子集触发总量帽）→ 422
    resp = await client.post(
        "/api/translate/thinking",
        json={"items": [{"id": f"i{n}", "text": "e" * 19000} for n in range(5)]},
        headers=auth_headers,
    )
    assert resp.status_code == 422
    # 空请求 → 422
    resp = await client.post("/api/translate/thinking", json={"items": []}, headers=auth_headers)
    assert resp.status_code == 422
