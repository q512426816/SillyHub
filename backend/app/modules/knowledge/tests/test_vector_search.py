"""向量检索端点与服务（change 2026-10-15-platform-vector-search；读路径去嵌入化
2026-11-05-knowledge-vector-async-refresh）。

测试面（fastembed 不进测试依赖——embedder 全部 fake 注入，真模型初始化属部署面）：

- 解析：段格式/字段行/spec_path POSIX 化/epoch 与 legacy 双 id 形态/非条目段跳过；
- 索引与后台构建：冷启动即时空返回+调度（门控 embedder 证请求路径零嵌入）、后台
  建库后可查、指纹未变零重建、stale-serve（旧索引出结果+后台重建）、在途判重、
  workspace 键隔离、分批形状（2026-11-02 OOM 根治面）、排序/limit/契约字段；
- fail-soft：embedder 不可用 → model_ready=False + 空 results + reason；查询嵌入
  超时/异常 → fail-soft 降级不抛且 timeout_sec 紧预算传达到 embedder；
- 禁建库开关：server_build=False 冷启动 reason=index_not_built 零调度、存量陈旧
  索引照常服务仅不再重建；
- 路由：无 token 401 / 非 shpsync 凭据 403 / happy path 两段契约（冷启动
  index_sync=scheduled 空结果 → 后台建库后真实召回 + 字段透传）/ 降级 200。
"""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path

import pytest

from app.main import app as fastapi_app
from app.modules.knowledge.vector_search import (
    _EMBED_BATCH_SIZE,
    _QUERY_EMBED_TIMEOUT_SEC,
    _bg_builds,
    await_background_builds_for_tests,
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
    """字符桶计数向量：text.count(ch) per 桶——「缓存」重的文本彼此相近。

    embed 接受 keyword-only timeout_sec（查询路紧预算传達面，2026-11-05 契约）。
    """

    def __init__(self) -> None:
        self.embed_calls = 0
        self.embedded_texts = 0
        self.batch_sizes: list[int] = []
        self.query_timeouts: list[float | None] = []

    def embed(self, texts: list[str], *, timeout_sec: float | None = None) -> list[list[float]]:
        self.embed_calls += 1
        self.embedded_texts += len(texts)
        self.batch_sizes.append(len(texts))
        if len(texts) == 1:
            self.query_timeouts.append(timeout_sec)
        return [[float(t.count(ch)) for ch in _BUCKET_CHARS] for t in texts]


class GatedCorpusEmbedder(FakeEmbedder):
    """语料批（>1 条）阻塞在门上的 embedder——证「请求即时返回、嵌入在后台」。

    同步实现会在请求路径等门（门不开 → 测试超时/断言失败）；异步实现请求侧零语料
    嵌入调用，门只放行后台构建线程。
    """

    def __init__(self) -> None:
        super().__init__()
        self.gate = threading.Event()
        self.corpus_batches = 0

    def embed(self, texts: list[str], *, timeout_sec: float | None = None) -> list[list[float]]:
        if len(texts) > 1:
            self.corpus_batches += 1
            assert self.gate.wait(timeout=30.0), "测试门未放行（构建被卡死）"
        return super().embed(texts, timeout_sec=timeout_sec)


class ExplodingQueryEmbedder(FakeEmbedder):
    """查询批（单条）按传入限时校验后抛异常——证 fail-soft 降级与 timeout_sec 传達。"""

    def embed(self, texts: list[str], *, timeout_sec: float | None = None) -> list[list[float]]:
        if len(texts) == 1:
            assert timeout_sec == _QUERY_EMBED_TIMEOUT_SEC, (
                f"查询路必须传紧限时 {_QUERY_EMBED_TIMEOUT_SEC}（实际 {timeout_sec}）"
            )
            raise TimeoutError("simulated worker hang")
        return super().embed(texts, timeout_sec=timeout_sec)


@pytest.fixture(autouse=True)
def _isolated_vector_state():
    """每测试清空索引缓存、embedder 单例与后台构建注册表（进程级全局态隔离）。"""
    reset_index_for_tests()
    reset_embedder_for_tests()
    await_background_builds_for_tests()
    yield
    await_background_builds_for_tests()
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


def _gen_bulk_entries(n: int, heavy_idx: int = 137) -> str:
    """n 条批量语料；heavy_idx 条目理由带「缓存」×3（跨批条目排序探针）。"""
    parts = ["# 决策知识 — bulk\n"]
    for i in range(1, n + 1):
        heavy = "缓存 " * 3 if i == heavy_idx else ""
        parts.append(
            f"\n## D-bulk-{i:03d}@v1 决策 {i}\n"
            f"变更：bulk-{i}\n状态：implemented\n理由：{heavy}批量条目 {i} 的理由文本。\n"
        )
    return "".join(parts)


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


# ── 冷启动/后台构建（2026-11-05-knowledge-vector-async-refresh）───────────────


def test_cold_query_returns_immediately_and_background_builds(tmp_path: Path) -> None:
    """FR-01：冷启动首查即时返回（门控 embedder 证请求路径零语料嵌入），
    后台建库完成后第二查返回真实召回。"""
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = GatedCorpusEmbedder()
    t0 = time.monotonic()
    first = search_sync(root, "ws-cold", "缓存淘汰", 10, emb, "test-model")
    elapsed = time.monotonic() - t0
    assert elapsed < 2.0, f"冷启动首查即时返回（实际 {elapsed:.2f}s——语料嵌入进了请求路径）"
    assert first["results"] == [] and first["model_ready"] is True
    assert first["index_sync"] == "scheduled", "冷启动契约标记"
    assert emb.embedded_texts == 0 and emb.corpus_batches == 0, "请求路径零嵌入调用"
    assert len(_bg_builds) == 1, "后台构建线程在途（被门阻塞）"

    emb.gate.set()  # 放行后台构建
    await_background_builds_for_tests()
    assert emb.corpus_batches == 1 and emb.embedded_texts == 3, "后台首建全量嵌入（3 条）"

    second = search_sync(root, "ws-cold", "缓存淘汰", 10, emb, "test-model")
    assert len(second["results"]) == 3, "建库完成后可查"
    assert "index_sync" not in second, "fresh 直查无调度标记"
    assert emb.query_timeouts == [_QUERY_EMBED_TIMEOUT_SEC], "查询嵌入带紧限时"


def test_inflight_build_dedup(tmp_path: Path) -> None:
    """FR-01 场景：同键在途构建判重——存活即跳过，不重复建（注册表强引用同一线程）。"""
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = GatedCorpusEmbedder()
    search_sync(root, "ws-dedup", "缓存", 10, emb, "test-model")  # 调度 → 阻塞在门
    in_flight = list(_bg_builds.values())
    assert len(in_flight) == 1 and in_flight[0].is_alive()

    search_sync(root, "ws-dedup", "缓存", 10, emb, "test-model")  # 再调度 → 判重跳过
    assert list(_bg_builds.values()) == in_flight, "在途即跳过（注册表同一线程对象）"

    emb.gate.set()
    await_background_builds_for_tests()
    assert emb.corpus_batches == 1 and emb.embedded_texts == 3, "同键只建一份索引"


def test_stale_index_serves_old_results_and_reschedules(tmp_path: Path) -> None:
    """FR-02：指纹失配 → 旧索引即时出结果 + index_sync=scheduled，重建在后台。"""
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = FakeEmbedder()
    search_sync(root, "ws-stale", "缓存", 10, emb, "test-model")
    await_background_builds_for_tests()

    time.sleep(0.01)  # 跨平台 mtime 精度兜底
    d = root / "knowledge" / "decisions" / "demo.md"
    d.write_text(
        d.read_text(encoding="utf-8") + "\n## D-004@v1 删除走软删\n变更：x\n理由：墓碑。\n",
        encoding="utf-8",
    )
    stale = search_sync(root, "ws-stale", "缓存", 10, emb, "test-model")
    assert stale["model_ready"] is True and stale["index_sync"] == "scheduled"
    anchors = [r["anchor"] for r in stale["results"]]
    assert anchors, "stale-serve 旧索引照常出结果"
    assert "D-004@v1" not in anchors, "旧索引不含新条目（重建尚未完成）"

    await_background_builds_for_tests()
    fresh = search_sync(root, "ws-stale", "缓存", 10, emb, "test-model")
    assert "D-004@v1" in [r["anchor"] for r in fresh["results"]], "后台重建后新条目可查"


# ── 索引与检索 ────────────────────────────────────────────────────────────────


def test_index_fingerprint_cache_and_invalidation(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = FakeEmbedder()
    first = search_sync(root, "ws-a", "缓存淘汰", 10, emb, "test-model")
    assert first["results"] == [] and first["index_sync"] == "scheduled", "冷启动即时空返回"
    assert emb.embedded_texts == 0, "请求路径零嵌入"
    await_background_builds_for_tests()
    assert emb.embedded_texts == 3, "后台首建全量嵌入（3 条语料）"

    second = search_sync(root, "ws-a", "缓存淘汰", 10, emb, "test-model")
    assert len(second["results"]) == 3
    assert emb.embedded_texts == 4, "指纹未变 → 零重建（只嵌查询 1 条）"

    time.sleep(0.01)
    d = root / "knowledge" / "decisions" / "demo.md"
    d.write_text(
        d.read_text(encoding="utf-8") + "\n## D-004@v1 删除走软删\n变更：x\n理由：墓碑。\n",
        encoding="utf-8",
    )
    stale = search_sync(root, "ws-a", "缓存淘汰", 10, emb, "test-model")
    assert emb.embedded_texts == 5, "stale-serve 只嵌查询（重建不在请求路径）"
    assert stale["index_sync"] == "scheduled"
    await_background_builds_for_tests()
    assert emb.embedded_texts == 9, "后台重建新语料全量（4 条）"

    third = search_sync(root, "ws-a", "缓存淘汰", 10, emb, "test-model")
    assert len(third["results"]) == 4 and emb.embedded_texts == 10

    # 不同 workspace key 各自建索引（互不串台）：冷启动空返回 + 后台独立建 4 条
    other = search_sync(root, "ws-b", "缓存淘汰", 10, emb, "test-model")
    assert other["results"] == [] and other["index_sync"] == "scheduled"
    await_background_builds_for_tests()
    assert emb.embedded_texts == 14, "workspace 键隔离各自建索引"


def test_index_rebuild_embeds_in_batches(tmp_path: Path) -> None:
    """FR-06（2026-11-02 生产 OOM 根治面等价迁移）：后台构建必须分批喂 embed——
    单次全量批曾把 embedding 子进程 RSS 推到 2.3~2.45GB 撞 2500m cgroup 配额。"""
    root = _seed_spec_root(tmp_path, _gen_bulk_entries(150))
    emb = FakeEmbedder()
    out = search_sync(root, "ws-batch", "缓存", 10, emb, "test-model")
    assert out["results"] == [] and emb.embedded_texts == 0, "请求路径零嵌入"
    await_background_builds_for_tests()

    corpus_batches = emb.batch_sizes
    assert all(b <= _EMBED_BATCH_SIZE for b in corpus_batches), "每批 ≤ 批上限"
    assert sum(corpus_batches) == 150, "分批不丢不重（150 条语料全覆盖）"
    assert len(corpus_batches) == (150 + _EMBED_BATCH_SIZE - 1) // _EMBED_BATCH_SIZE, (
        "满批条数 = ceil(150/批上限)，末批为余数"
    )
    out2 = search_sync(root, "ws-batch", "缓存", 10, emb, "test-model")
    assert emb.batch_sizes[-1] == 1, "查询独立 1 条成批"
    assert emb.embedded_texts == 151, "分批不丢不重（150 语料 + 1 查询）"
    assert out2["results"][0]["anchor"] == "D-bulk-137@v1", (
        "分批按序聚合——跨批条目（第 137 条在末批）排序不回归"
    )


def test_small_corpus_stays_single_batch(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = FakeEmbedder()
    search_sync(root, "ws-small", "缓存", 10, emb, "test-model")
    await_background_builds_for_tests()
    search_sync(root, "ws-small", "缓存", 10, emb, "test-model")
    assert emb.batch_sizes == [3, 1], "≤批上限条语料单批嵌入（分批不改变小语料行为面）"


def test_search_ranking_limit_and_contract(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = FakeEmbedder()
    search_sync(root, "ws-rank", "预热", 10, emb, "test-model")  # 触发后台建库
    await_background_builds_for_tests()

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


# ── fail-soft 与查询嵌入限时 ─────────────────────────────────────────────────


def test_embedder_unavailable_fail_soft(tmp_path: Path) -> None:
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    out = search_sync(
        root, "ws-dead", "缓存", 10, None, "test-model", embedder_error="ImportError: fastembed"
    )
    assert out["model_ready"] is False, "不可用态标记"
    assert out["results"] == [], "不可用 → 空 results（CLI 静默降级本地层）"
    assert "fastembed" in out["reason"], "reason 带因（可观测键）"


def test_query_embed_timeout_degrades_fail_soft(tmp_path: Path) -> None:
    """FR-04：查询嵌入超时/异常 → fail-soft 降级（model_ready=False + reason 带因），
    且 timeout_sec 紧预算传达到 embedder（非 300s 缺省）。"""
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = ExplodingQueryEmbedder()
    search_sync(root, "ws-timeout", "预热", 10, emb, "test-model")
    await_background_builds_for_tests()

    out = search_sync(root, "ws-timeout", "缓存", 10, emb, "test-model")
    assert out["model_ready"] is False, "查询嵌入失败 → 降级标记"
    assert out["results"] == [], "降级空结果"
    assert "TimeoutError" in out["reason"], "reason 带因（异常名可观测）"


# ── 禁建库开关（2026-10-19 治理口径随迁）────────────────────────────────────


def test_server_build_disabled_skips_scheduling(tmp_path: Path) -> None:
    """FR-03：server_build=False 冷启动 reason=index_not_built 零调度零嵌入；
    存量索引（含陈旧）照常服务，仅不再重建。"""
    root = _seed_spec_root(tmp_path, _TWO_ENTRIES)
    emb = FakeEmbedder()
    out = search_sync(root, "ws-off", "缓存", 10, emb, "test-model", server_build=False)
    assert out["results"] == [] and out["model_ready"] is True
    assert out["reason"] == "index_not_built", "reason 对齐 search.py 禁建库口径"
    assert emb.embedded_texts == 0, "禁建库路径零嵌入（语料与查询均零）"
    assert len(_bg_builds) == 0, "零调度（注册表空）"

    # 存量索引照常服务：先放开开关建库，再关开关 + 语料变更 → stale 服务不重建
    search_sync(root, "ws-off2", "缓存", 10, emb, "test-model")
    await_background_builds_for_tests()
    assert emb.embedded_texts == 3
    time.sleep(0.01)
    d = root / "knowledge" / "decisions" / "demo.md"
    d.write_text(
        d.read_text(encoding="utf-8") + "\n## D-004@v1 删除走软删\n变更：x\n理由：墓碑。\n",
        encoding="utf-8",
    )
    served = search_sync(root, "ws-off2", "缓存", 10, emb, "test-model", server_build=False)
    assert served["results"], "禁建库 + 存量索引照常服务"
    assert "D-004@v1" not in [r["anchor"] for r in served["results"]], "服务的是旧索引"
    assert "index_sync" not in served, "不再调度重建"
    assert emb.embedded_texts == 4, "无重嵌（3 建库 + 1 查询）"
    assert len(_bg_builds) == 0


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
    """两段契约：冷启动 200 空结果 + index_sync=scheduled → 后台建库 → 真实召回。"""
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
        assert body["results"] == [], "冷启动即时空结果（请求不嵌语料）"
        assert body["index_sync"] == "scheduled", "index_sync 契约透传"

        await_background_builds_for_tests()  # 后台建库收口

        resp2 = await client.post(
            "/api/spec/knowledge/vector-search",
            json={"query": "缓存淘汰策略", "limit": 10},
        )
        assert resp2.status_code == 200, resp2.text
        body2 = resp2.json()
        assert body2["model_ready"] is True and body2.get("index_sync") is None
        assert body2["results"], "语料在场必非空"
        top = body2["results"][0]
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
