"""向量检索端点与服务（change 2026-10-15-platform-vector-search）。

测试面（fastembed 不进测试依赖——embedder 全部 fake 注入，真模型初始化属部署面）：

- 解析：段格式/字段行/spec_path POSIX 化/epoch 与 legacy 双 id 形态/非条目段跳过；
- 索引：指纹缓存（文件不变零重建、增改后重建）、余弦排序、limit 钳位、契约字段；
- fail-soft：embedder 不可用 → model_ready=False + 空 results + reason（CLI 降级面）；
- 路由：无 token 401 / 非 shpsync 凭据 403（workspace_id=None scope）/ happy path
  契约形状（依赖覆盖 require_platform_sync + 真 workspace 行 + spec_root 重定向）/
  降级 200（get_embedder 注入不可用态）。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.main import app as fastapi_app
from app.modules.knowledge.vector_search import (
    decisions_fingerprint,
    parse_decision_entries,
    reset_embedder_for_tests,
    reset_index_for_tests,
    search_sync,
)
from app.modules.spec_workspace.model import SpecWorkspace

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"

# ── fake embedder：字符桶计数向量（确定性，缓存/排序/契约断言够用）──────────────

_BUCKET_CHARS = ["缓", "存", "索", "引", "发", "布", "删", "除"]


class FakeEmbedder:
    """字符桶计数向量：text.count(ch) per 桶——「缓存」重的文本彼此相近。"""

    def __init__(self) -> None:
        self.embed_calls = 0
        self.embedded_texts = 0

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.embed_calls += 1
        self.embedded_texts += len(texts)
        return [[float(t.count(ch)) for ch in _BUCKET_CHARS] for t in texts]


@pytest.fixture(autouse=True)
def _isolated_vector_state():
    """每测试清空索引缓存与 embedder 单例（进程级全局态隔离）。"""
    reset_index_for_tests()
    reset_embedder_for_tests()
    yield
    reset_index_for_tests()
    reset_embedder_for_tests()


def _seed_spec_root(tmp_path: Path, entries: str, decisions: bool = True) -> Path:
    root = tmp_path / "spec"
    d = root / "knowledge" / "decisions"
    if decisions:
        d.mkdir(parents=True, exist_ok=True)
        (d / "demo.md").write_text(entries, encoding="utf-8")
    else:
        root.mkdir(parents=True, exist_ok=True)
    return root


_TWO_ENTRIES = """# 决策知识 — demo

## D-001@v1 缓存淘汰用 LRU
变更：2026-10-01-cache-lru
状态：implemented
理由：命中率高，淘汰策略简单可测。

## D-002@v1 索引不建在写热点上
变更：2026-10-02-index-hotspot
状态：implemented
理由：写放大不可接受，读侧补索引。

## D-unmapped-003@v2 epoch 全局号条目
变更：2026-10-03-epoch
状态：implemented
理由：epoch 迁移后形态。
"""


# ── 解析 ─────────────────────────────────────────────────────────────────────


def test_parse_decision_entries_fields_and_shapes(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    entries = parse_decision_entries(root)
    assert [e.anchor for e in entries] == ["D-001@v1", "D-002@v1", "D-unmapped-003@v2"], (
        "三段全解析（epoch+legacy 双形态）"
    )
    first = entries[0]
    assert first.spec_path == "knowledge/decisions/demo.md", (
        "spec_path POSIX 固定前缀（CLI 消费过滤面）"
    )
    assert first.change == "2026-10-01-cache-lru", "变更行进 change（同号消歧）"
    assert "LRU" in first.text and "命中率高" in first.text, "embedding 文本 = id+标题+理由"
    assert "状态" not in entries[0].text, "状态行不入 embedding 文本"


def test_parse_decision_entries_absent_dir(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, "", decisions=False)
    assert parse_decision_entries(root) == [], "decisions 缺席 fail-soft 空语料"
    assert decisions_fingerprint(root) is None, "指纹缺席 None"


# ── 索引与检索 ────────────────────────────────────────────────────────────────


def test_index_fingerprint_cache_and_invalidation(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = FakeEmbedder()
    first = search_sync(root, "ws-a", "缓存淘汰", 10, emb, "test-model")
    assert len(first["results"]) == 3
    # 首查 = 语料重建（3 条）+ 查询（1 条）= 4 文本
    assert emb.embedded_texts == 4, f"首查语料+查询全量 embed（实际 {emb.embedded_texts}）"
    search_sync(root, "ws-a", "缓存淘汰", 10, emb, "test-model")
    assert emb.embedded_texts == 5, "指纹未变 → 索引缓存零重建（只多查询 1 条）"
    # 追加内容改变 mtime/size → 重建（4 条语料 + 1 查询 = 10）
    import time

    time.sleep(0.01)
    d = root / "knowledge" / "decisions" / "demo.md"
    d.write_text(
        d.read_text(encoding="utf-8") + "\n## D-004@v1 删除走软删\n变更：x\n理由：墓碑。\n",
        encoding="utf-8",
    )
    second = search_sync(root, "ws-a", "缓存淘汰", 10, emb, "test-model")
    assert emb.embedded_texts == 10, "文件变更 → 指纹失效重建（4 语料+1 查询）"
    assert len(second["results"]) == 4
    # 不同 workspace key 各自建索引（互不串台）：改后语料 4 条，+4 +1 查询 = 15
    search_sync(root, "ws-b", "缓存淘汰", 10, emb, "test-model")
    assert emb.embedded_texts == 15, "workspace 键隔离各自建索引"


def test_search_ranking_limit_and_contract(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = FakeEmbedder()
    out = search_sync(root, "ws-rank", "缓存淘汰策略", 2, emb, "test-model")
    assert out["model_ready"] is True and out["reason"] is None
    assert len(out["results"]) == 2, "limit 截断"
    top = out["results"][0]
    assert set(top) == {"spec_path", "anchor", "change", "score"}, "契约四键（CLI 消费面）"
    assert top["anchor"] == "D-001@v1", "「缓存」重文本排前（余弦序）"
    assert out["results"][0]["score"] >= out["results"][1]["score"], "分数降序"
    # limit 钳位边界由路由层负责；服务层如实按 limit 截断
    empty_q = search_sync(root, "ws-rank", "   ", 10, emb, "test-model")
    assert empty_q["results"] == [] and empty_q["model_ready"] is True, "空查询零结果不报错"


def test_embedder_unavailable_fail_soft(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    out = search_sync(
        root, "ws-dead", "缓存", 10, None, "test-model", embedder_error="ImportError: fastembed"
    )
    assert out["model_ready"] is False, "不可用态标记"
    assert out["results"] == [], "不可用 → 空 results（CLI 静默降级本地层）"
    assert "fastembed" in out["reason"], "reason 带因（可观测键）"


# ── 路由 ─────────────────────────────────────────────────────────────────────


@pytest.fixture()
async def vector_workspace(
    client, db_session, tmp_path: Path, auth_headers: dict[str, str]
) -> dict:
    """真 workspace 行 + spec_root 重定向到临时树（decisions 语料两条件目）。"""
    root = tmp_path / "ws-spec"
    d = root / "knowledge" / "decisions"
    d.mkdir(parents=True)
    (d / "demo.md").write_text(_TWO_ENTRIES, encoding="utf-8")
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "vector-test", "root_path": str(root), "type": "other"},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = uuid.UUID(ws_resp.json()["id"])
    from sqlmodel import select

    spec_ws = (
        await db_session.execute(select(SpecWorkspace).where(SpecWorkspace.workspace_id == ws_id))
    ).scalar_one()
    spec_ws.spec_root = str(root)
    await db_session.commit()
    return {"ws_id": ws_id}


@pytest.fixture()
def fake_embedder_env(monkeypatch):
    """get_embedder 注入 fake（路由 import 面 = vector_router 命名空间）。"""
    from app.modules.knowledge import vector_router

    emb = FakeEmbedder()
    monkeypatch.setattr(vector_router, "get_embedder", lambda model_name: (emb, None))
    return emb


async def test_vector_search_requires_token(client) -> None:
    resp = await client.post(
        "/api/spec/knowledge/vector-search",
        json={"query": "缓存", "limit": 5},
    )
    assert resp.status_code == 401, "无凭据 401（AuthTokenMissing 依赖内抛）"


async def test_vector_search_rejects_non_shpsync_scope(
    client, vector_workspace: dict, fake_embedder_env
) -> None:
    from app.modules.platform_sync.auth import PlatformSyncAuthScope, require_platform_sync

    async def _jwt_scope():  # 凭据有效但 workspace_id=None（JWT/APIKey 并集形态）
        from app.modules.auth.model import User

        return User(id=uuid.uuid4()), PlatformSyncAuthScope()

    fastapi_app.dependency_overrides[require_platform_sync] = _jwt_scope
    try:
        resp = await client.post(
            "/api/spec/knowledge/vector-search",
            json={"query": "缓存", "limit": 5},
        )
        assert resp.status_code == 403, "非 shpsync 通道 403（凭据有效但通道关闭）"
    finally:
        fastapi_app.dependency_overrides.pop(require_platform_sync, None)


async def test_vector_search_happy_path_contract(
    client, vector_workspace: dict, fake_embedder_env
) -> None:
    from app.modules.platform_sync.auth import PlatformSyncAuthScope, require_platform_sync

    async def _sync_scope():
        from app.modules.auth.model import User

        return User(id=uuid.uuid4()), PlatformSyncAuthScope(workspace_id=vector_workspace["ws_id"])

    fastapi_app.dependency_overrides[require_platform_sync] = _sync_scope
    try:
        resp = await client.post(
            "/api/spec/knowledge/vector-search",
            json={"query": "缓存淘汰策略", "limit": 10},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True and body["model_ready"] is True
        assert body["results"], "语料在场必非空"
        top = body["results"][0]
        assert set(top) == {"spec_path", "anchor", "change", "score"}, "CLI 契约四键"
        assert top["spec_path"].startswith("knowledge/decisions/"), (
            "CLI buildResultFromPlatform 过滤前缀"
        )
        assert top["anchor"] == "D-001@v1", "「缓存」重条目排前"
        assert top["change"] == "2026-10-01-cache-lru", "change 透传（同号消歧）"
    finally:
        fastapi_app.dependency_overrides.pop(require_platform_sync, None)


async def test_vector_search_degraded_when_model_unavailable(
    client, vector_workspace: dict, monkeypatch
) -> None:
    from app.modules.knowledge import vector_router
    from app.modules.platform_sync.auth import PlatformSyncAuthScope, require_platform_sync

    monkeypatch.setattr(
        vector_router, "get_embedder", lambda model_name: (None, "ImportError: fastembed missing")
    )

    async def _sync_scope():
        from app.modules.auth.model import User

        return User(id=uuid.uuid4()), PlatformSyncAuthScope(workspace_id=vector_workspace["ws_id"])

    fastapi_app.dependency_overrides[require_platform_sync] = _sync_scope
    try:
        resp = await client.post(
            "/api/spec/knowledge/vector-search",
            json={"query": "缓存", "limit": 5},
        )
        assert resp.status_code == 200, "降级是 200 契约不是 5xx（CLI 按空 results 静默降级）"
        body = resp.json()
        assert body["ok"] is True and body["results"] == []
        assert body["model_ready"] is False and "fastembed" in body["reason"]
    finally:
        fastapi_app.dependency_overrides.pop(require_platform_sync, None)
