"""平台知识搜索服务单测（change 2026-10-15-platform-knowledge-search / task-01）。

测试面（fastembed 不进测试依赖——embedder 全部 fake 注入，真模型属部署面）：

- 扫描：knowledge/ + docs/ 全量收录、INDEX.md 零收录、symlink 跳过；
- 切块三档：decision 条目（D-xxx@vN）/ fr 条目（FR-xxx-NNN）/ 标题块（## 切 + 超长滑窗
  1500/1000/150）、frontmatter 排除；
- kind 派生全表；
- 指纹：文件未变二次查询零重建（embed_calls 计数）、增改后重建；
- 融合检索：精确编号 rank=1（title 词面命中保底）、纯语义可召回（fake 向量近邻）、
  embedder 不可用 → model_ready=False + 纯词面 + reason；
- snippet：词面命中取 ±120 字符窗口；无词面命中取头部 240 字符。
"""

from __future__ import annotations

import itertools
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.knowledge.search import (
    Chunk,
    chunk_markdown,
    corpus_fingerprint,
    reset_index_for_tests,
    scan_corpus,
    search_sync,
)

# ── fake embedder：字符桶计数向量（确定性；对齐 test_vector_search.py 形态）────────

_BUCKET_CHARS = ["缓", "存", "索", "引", "会", "话", "状", "态"]


class FakeEmbedder:
    """字符桶计数向量：text.count(ch) per 桶——「会话状态」重的文本彼此相近。"""

    def __init__(self) -> None:
        self.embed_calls = 0
        self.embedded_texts = 0

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.embed_calls += 1
        self.embedded_texts += len(texts)
        return [[float(t.count(ch)) for ch in _BUCKET_CHARS] for t in texts]


@pytest.fixture(autouse=True)
def _reset_search_index() -> Iterator[None]:
    """测试隔离：每个用例前后清空进程内同步锁。"""
    reset_index_for_tests()
    yield
    reset_index_for_tests()


@pytest.fixture()
async def search_env(db_engine, db_session, tmp_path: Path):
    """检索持久化测试环境：真实 workspace 行 + 测试引擎会话工厂。

    返回 ``(workspace_key, session_factory)``——search_sync 的 DB 面经 SQLite
    测试引擎（with_variant JSON 路径），workspace 行满足两表 FK 约束。
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.modules.workspace.model import Workspace

    ws = Workspace(
        name=f"ks-test-{uuid.uuid4().hex[:8]}",
        slug=f"ks-test-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
    return str(ws.id), factory


# ── 语料构造 helpers ─────────────────────────────────────────────────────────


def _write(root: Path, rel: str, content: str) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


DECISIONS_DOC = """---
note: frontmatter 不入 embedding
---

## D-001@v1 缓存索引策略

状态：implemented
变更：2026-10-15-demo-change
理由：索引只缓存不落库。

## D-002@v1 会话状态点语义

状态：implemented
变更：2026-10-15-demo-change
理由：行首状态点五态，转圈取活性推导。
"""

FR_DOC = """## FR-demo-001 搜索入口

状态：active
摘要：默认场景
场景正文：
- 场景：输入关键词失败时显示错误。

## FR-demo-002 结果跳转

状态：active
摘要：默认场景
场景正文：
- 场景：点击结果定位到条目。
"""


def _mini_corpus(root: Path) -> Path:
    """最小语料：decisions + fr + knowledge 手册 + docs 模块 + INDEX.md（应被排除）。"""
    _write(root, "knowledge/decisions/demo.md", DECISIONS_DOC)
    _write(root, "knowledge/fr/demo.md", FR_DOC)
    _write(
        root,
        "knowledge/known-issues.md",
        "# 已知问题合集\n\n## 会话日志中文乱码\n\nWindows 控制台码页导致落库即坏。\n",
    )
    _write(
        root,
        "knowledge/INDEX.md",
        "# Knowledge Index\n\n- 不该被收录 → [x](x.md#y)\n",
    )
    _write(
        root,
        "docs/demo/modules/frontend.md",
        "---\nschema_version: 1\n---\n# 前端控制台（frontend）\n\n## 定位\n\nWeb 控制台。\n",
    )
    _write(root, "docs/demo/glossary.md", "# 术语表\n\n## 会话状态点\n\n五态定义。\n")
    _write(root, "changes/some-change/design.md", "# 变更设计（不应收录）\n")
    return root


# ── 扫描 ─────────────────────────────────────────────────────────────────────


def test_scan_corpus_covers_knowledge_and_docs_excludes_index_and_changes(
    tmp_path: Path,
) -> None:
    _mini_corpus(tmp_path)
    chunks = scan_corpus(tmp_path)
    paths = {c.spec_path for c in chunks}
    assert any(p.startswith("knowledge/decisions/") for p in paths)
    assert any(p.startswith("knowledge/fr/") for p in paths)
    assert any(p.startswith("docs/demo/modules/") for p in paths)
    # INDEX.md 与 changes/ 零收录
    assert all(not p.endswith("INDEX.md") for p in paths)
    assert all(not p.startswith("changes/") for p in paths)
    # spec_path 恒为 POSIX 形态（Windows 分隔符不得出现）
    assert all("\\" not in p for p in paths)


def test_scan_corpus_missing_dirs_returns_empty(tmp_path: Path) -> None:
    assert scan_corpus(tmp_path) == []


# ── kind 派生全表 ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("spec_path", "kind"),
    [
        ("knowledge/decisions/frontend.md", "decision"),
        ("knowledge/fr/backend.md", "fr"),
        ("knowledge/proposed/slug.md", "proposed"),
        ("knowledge/generated/gen.md", "generated"),
        ("knowledge/known-issues.md", "knowledge"),
        ("docs/p/modules/frontend.md", "module"),
        ("docs/p/scan/PROJECT.md", "scan"),
        ("docs/p/flows/auth-flow.md", "flow"),
        ("docs/p/glossary.md", "glossary"),
    ],
)
def test_kind_derivation_full_table(tmp_path: Path, spec_path: str, kind: str) -> None:
    chunks = chunk_markdown(spec_path, "## 小节\n\n正文。\n")
    assert chunks, "至少产出一个块"
    assert all(c.kind == kind for c in chunks)


# ── 切块：条目档 ─────────────────────────────────────────────────────────────


def test_chunk_decision_entries_anchor_and_title() -> None:
    chunks = chunk_markdown("knowledge/decisions/demo.md", DECISIONS_DOC)
    anchors = [c.anchor for c in chunks]
    assert anchors == ["D-001@v1", "D-002@v1"]
    assert chunks[0].title == "缓存索引策略"
    assert "缓存" in chunks[0].text
    # frontmatter 不入 text
    assert all("frontmatter" not in c.text for c in chunks)
    # start_line 指向标题行（1-based；frontmatter 占前 3 行 + 空行）
    assert chunks[0].start_line == 5


def test_chunk_fr_entries_anchor_and_title() -> None:
    chunks = chunk_markdown("knowledge/fr/demo.md", FR_DOC)
    assert [c.anchor for c in chunks] == ["FR-demo-001", "FR-demo-002"]
    assert chunks[1].title == "结果跳转"


# ── 切块：标题档 + 滑窗 + frontmatter ────────────────────────────────────────


def test_chunk_generic_h2_sections_with_slug_anchor() -> None:
    doc = "---\na: 1\n---\n# 文档标题\n\n## 会话状态点\n\n正文 A。\n\n## 缓存索引\n\n正文 B。\n"
    chunks = chunk_markdown("docs/p/modules/demo.md", doc)
    titles = [c.title for c in chunks]
    assert titles == ["会话状态点", "缓存索引"]
    assert chunks[0].anchor == "会话状态点"  # slugify：中文原样保留
    assert all("a: 1" not in c.text for c in chunks)


def test_chunk_long_section_slides_with_overlap() -> None:
    body = "\n".join(f"第 {i} 行填充内容缓存索引会话状态。" for i in range(300))
    doc = f"## 长小节\n\n{body}\n"
    chunks = chunk_markdown("docs/p/modules/big.md", doc)
    assert len(chunks) > 1, "超长小节应被滑窗切为多块"
    assert all(c.title == "长小节" for c in chunks)
    # 相邻块重叠 >0（后块 start_line 回退）
    for prev, nxt in itertools.pairwise(chunks):
        assert nxt.start_line <= prev.start_line + _window_line_span(prev)
    # 每块不超过阈值上限的宽松界（单行硬切场景除外）
    assert all(len(c.text) <= 1500 + 200 for c in chunks)


def _window_line_span(chunk: Chunk) -> int:
    return chunk.text.count("\n") + 1


def test_chunk_file_without_sections_is_single_windowed_chunk() -> None:
    doc = "无标题纯文本。\n" * 200
    chunks = chunk_markdown("knowledge/note.md", doc)
    assert chunks
    assert all(c.anchor is None for c in chunks)


# ── 指纹 ─────────────────────────────────────────────────────────────────────


def test_corpus_fingerprint_none_when_dirs_absent(tmp_path: Path) -> None:
    assert corpus_fingerprint(tmp_path) is None


async def test_search_reuses_index_until_files_change(tmp_path: Path, search_env) -> None:
    _mini_corpus(tmp_path)
    fake = FakeEmbedder()
    out1 = await search_sync(
        tmp_path, search_env[0], "会话状态点", 5, fake, "fake-model", session_factory=search_env[1]
    )
    assert out1["model_ready"] is True
    calls_after_first = fake.embed_calls
    assert calls_after_first >= 2  # 语料构建 1 次 + query 1 次
    out2 = await search_sync(
        tmp_path, search_env[0], "会话状态点", 5, fake, "fake-model", session_factory=search_env[1]
    )
    assert fake.embed_calls == calls_after_first + 1, "文件未变仅 query embed，不重建索引"
    assert out2["results"]
    # 语料变更 → 重建（再多一次全量 embed）
    _write(tmp_path, "knowledge/known-issues.md", "# 新内容\n\n## 新增小节\n\n状态点补充。\n")
    await search_sync(
        tmp_path, search_env[0], "状态点", 5, fake, "fake-model", session_factory=search_env[1]
    )
    assert fake.embed_calls >= calls_after_first + 3, "文件变更后应重建索引"


# ── 融合检索 ─────────────────────────────────────────────────────────────────


async def test_search_exact_decision_id_ranks_first(tmp_path: Path, search_env) -> None:
    _mini_corpus(tmp_path)
    fake = FakeEmbedder()
    out = await search_sync(
        tmp_path, search_env[0], "D-002@v1", 5, fake, "fake-model", session_factory=search_env[1]
    )
    results = out["results"]
    assert results, "精确编号应命中"
    top = results[0]
    assert top["anchor"] == "D-002@v1"
    assert top["spec_path"] == "knowledge/decisions/demo.md"
    assert top["score"] >= 0.9
    assert {
        "spec_path",
        "kind",
        "title",
        "anchor",
        "snippet",
        "score",
    } <= set(top.keys())


async def test_search_pure_semantic_recall_without_word_hit(tmp_path: Path, search_env) -> None:
    _write(
        tmp_path,
        "knowledge/manual.md",
        "# 手册\n\n## 会话过程\n\n列表里的状态点会转圈。\n",
    )
    _write(
        tmp_path,
        "knowledge/other.md",
        "# 其他\n\n## 缓存索引分发\n\n缓存索引只在进程内。\n",
    )
    fake = FakeEmbedder()
    # 「会话状态」在语料中无连续子串（「会话过程」/「状态点」分离）→ 纯语义路召回
    out = await search_sync(
        tmp_path, search_env[0], "会话状态", 5, fake, "fake-model", session_factory=search_env[1]
    )
    results = out["results"]
    assert results, "纯语义应可召回"
    assert results[0]["spec_path"] == "knowledge/manual.md"
    assert results[0]["title"] == "会话过程"


async def test_search_degraded_word_only_when_embedder_unavailable(
    tmp_path: Path, search_env
) -> None:
    _mini_corpus(tmp_path)
    out = await search_sync(
        tmp_path,
        search_env[0],
        "会话状态点",
        5,
        None,
        "fake-model",
        embedder_error="ImportError: fastembed",
        session_factory=search_env[1],
    )
    assert out["model_ready"] is False
    assert out["reason"] == "ImportError: fastembed"
    assert out["results"], "降级仍应返回词面结果"
    assert all(r["score"] <= 1.0 for r in out["results"])
    # 词面命中：snippet 含查询词
    assert any("会话状态点" in r["snippet"] for r in out["results"])


async def test_search_empty_query_returns_empty(tmp_path: Path, search_env) -> None:
    _mini_corpus(tmp_path)
    fake = FakeEmbedder()
    out = await search_sync(
        tmp_path, search_env[0], "   ", 5, fake, "fake-model", session_factory=search_env[1]
    )
    assert out["results"] == []
    assert out["model_ready"] is True
    assert out["reason"] is None


async def test_search_snippet_window_around_match(tmp_path: Path, search_env) -> None:
    filler = "填充" * 200
    doc = f"## 目标小节\n\n{filler}会话状态点{filler}\n"
    _write(tmp_path, "knowledge/snip.md", doc)
    fake = FakeEmbedder()
    out = await search_sync(
        tmp_path, search_env[0], "会话状态点", 3, fake, "fake-model", session_factory=search_env[1]
    )
    results = out["results"]
    assert results
    snippet = results[0]["snippet"]
    assert "会话状态点" in snippet
    # 窗口截断：snippet 显著短于整段
    assert len(snippet) < 400


async def test_search_missing_corpus_returns_empty(tmp_path: Path, search_env) -> None:
    fake = FakeEmbedder()
    out = await search_sync(
        tmp_path, search_env[0], "任意", 5, fake, "fake-model", session_factory=search_env[1]
    )
    assert out["results"] == []
    assert out["model_ready"] is True


async def test_search_unrelated_query_returns_empty_state(tmp_path: Path, search_env) -> None:
    """零信号块过滤：无关查询（无词面命中 + 向量零相似）→ 空态可达，不返回 0 分噪声。"""
    _mini_corpus(tmp_path)
    fake = FakeEmbedder()
    out = await search_sync(
        tmp_path,
        search_env[0],
        "量子力学哈密顿算子",
        5,
        fake,
        "fake-model",
        session_factory=search_env[1],
    )
    assert out["results"] == [], "无信号查询应返回空（前端空态）"


# ── 持久化 ORM 面（change 2026-10-15-knowledge-search-pgvector / task-01）────────


async def test_orm_tables_create_all_on_sqlite(db_engine) -> None:
    """with_variant 双方言：SQLite 内存引擎建表命中 JSON 变体（无 vector 类型依赖）。"""
    from sqlalchemy import inspect

    from app.modules.knowledge.search import KnowledgeSearchChunk, KnowledgeSearchState

    async with db_engine.connect() as conn:
        tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    assert "knowledge_search_chunks" in tables
    assert "knowledge_search_state" in tables
    # embedding 列在 SQLite 下可写可读（JSON 文本形态）——直接落一行验证
    assert KnowledgeSearchChunk.__tablename__ == "knowledge_search_chunks"
    assert KnowledgeSearchState.__tablename__ == "knowledge_search_state"


async def test_chunk_row_roundtrip_and_uq(db_session) -> None:
    """chunk 行读写往返 + uq(workspace_id, spec_path, anchor, title) 约束拒绝重复。"""
    import uuid

    from sqlalchemy.exc import IntegrityError

    from app.modules.knowledge.search import KnowledgeSearchChunk

    ws = uuid.uuid4()
    row = KnowledgeSearchChunk(
        workspace_id=ws,
        spec_path="knowledge/decisions/demo.md",
        kind="decision",
        title="缓存索引策略",
        anchor="D-001@v1",
        start_line=5,
        text="D-001@v1 缓存索引策略\n正文",
        content_hash="a" * 64,
        embedding=[0.1, 0.2, 0.3],
    )
    db_session.add(row)
    await db_session.commit()

    dup = KnowledgeSearchChunk(
        workspace_id=ws,
        spec_path="knowledge/decisions/demo.md",
        kind="decision",
        title="缓存索引策略",
        anchor="D-001@v1",
        start_line=6,
        text="不同正文",
        content_hash="b" * 64,
        embedding=[0.4],
    )
    db_session.add(dup)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_migration_dialect_guard() -> None:
    """迁移方言守卫：非 PG bind 上 upgrade() 静默返回（不建表不炸；fail-closed 文案钉住）。"""
    import importlib.util
    import pathlib

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect

    # tests 文件 = backend/app/modules/knowledge/tests/ → parents[4] = backend/
    mig_path = (
        pathlib.Path(__file__).resolve().parents[4]
        / "migrations"
        / "versions"
        / "20261015200000_knowledge_search_pgvector.py"
    )
    spec = importlib.util.spec_from_file_location("ks_migration", mig_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        mc = MigrationContext.configure(conn)
        with Operations.context(mc):
            mod.upgrade()  # 非 PG → 首行 return，无任何 DDL
        assert "knowledge_search_chunks" not in inspect(conn).get_table_names()

    text = mig_path.read_text(encoding="utf-8")
    assert 'dialect.name != "postgresql"' in text
    assert "pgvector/pgvector:pg16" in text  # fail-closed 修复指引文案（R-06）


# ── 持久化行为面（2026-10-15-knowledge-search-pgvector / task-02）──────────────


async def test_search_model_version_change_triggers_full_rebuild(
    tmp_path: Path, search_env
) -> None:
    """model_version 变更 → 全量重嵌一次（D-007@v1：嵌入计数 = 语料 chunk 数）。"""
    _mini_corpus(tmp_path)
    fake = FakeEmbedder()
    await search_sync(
        tmp_path, search_env[0], "状态点", 5, fake, "model-a", session_factory=search_env[1]
    )
    embedded_a = fake.embedded_texts
    assert embedded_a > 0
    # 换模型名 → 全量重算（再嵌入全部 chunk）+ 1 次 query 嵌入
    out = await search_sync(
        tmp_path, search_env[0], "状态点", 5, fake, "model-b", session_factory=search_env[1]
    )
    assert fake.embedded_texts == embedded_a * 2  # 全量(chunks) + query，与首次同构
    assert out["results"]


async def test_search_db_error_falls_back_to_word_scan(tmp_path: Path, search_env) -> None:
    """DB 异常 → 词面内存直查降级：200 语义（不抛）+ reason 带 db_degraded 前缀。"""
    _mini_corpus(tmp_path)
    fake = FakeEmbedder()

    class _BoomFactory:
        def __call__(self):
            raise RuntimeError("connection refused")

    out = await search_sync(
        tmp_path,
        search_env[0],
        "会话状态点",
        5,
        fake,
        "fake-model",
        session_factory=_BoomFactory(),
    )
    assert out["model_ready"] is True  # embedder 在场（降级只降 DB 面）
    assert out["reason"] is not None and "knowledge_search_db_degraded" in out["reason"]
    assert out["results"], "降级仍应返回词面结果"
    top = out["results"][0]
    assert (
        top["score"] >= 0.6 and "会话状态点" in top["title"]
    )  # 词面 title 命中排前（与内存版同构）


async def test_search_delta_reembeds_only_changed_file(tmp_path: Path, search_env) -> None:
    """差量四态：单文件内容变更 → 仅该文件 chunk 重嵌（嵌入计数精确递增）。"""
    _mini_corpus(tmp_path)
    fake = FakeEmbedder()
    await search_sync(
        tmp_path, search_env[0], "状态点", 5, fake, "m", session_factory=search_env[1]
    )
    baseline = fake.embedded_texts
    # 改单文件（known-issues.md 新增一段）
    p = tmp_path / "knowledge" / "known-issues.md"
    p.write_text(
        p.read_text(encoding="utf-8") + "\n## 新增小节\n\n状态点补充内容。\n", encoding="utf-8"
    )
    out = await search_sync(
        tmp_path, search_env[0], "状态点", 5, fake, "m", session_factory=search_env[1]
    )
    # known-issues.md 原 1 块 + 新增 1 块 = 重嵌 2 块 + query 1 次
    assert fake.embedded_texts == baseline + 2
    assert any(r["title"] == "新增小节" for r in out["results"]), "新内容应可搜到"
