"""Tests for spec bundle / sync endpoints (task-06).

Covers FR-05:
- GET .../spec-workspace/bundle → tar stream, excludes .runtime/
- POST .../spec-workspace/sync → overwrite spec_root + reparse

author: qinyi
created_at: 2026-06-18
"""

from __future__ import annotations

import asyncio
import io
import tarfile
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_workspace(db_session, *, component_key: str | None = "comp") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="bundle-sync ws",
        slug=f"bs-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/bundle-sync-test",
        status="active",
        component_key=component_key,
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(
    db_session,
    workspace: Workspace,
    spec_root: Path,
    *,
    strategy: str = "platform-managed",
    spec_version: int = 0,
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(spec_root),
        strategy=strategy,
        sync_status="clean",
        spec_version=spec_version,
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _build_tar(members: dict[str, bytes | None]) -> bytes:
    """Build an in-memory tar. value=None → directory entry."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for name, data in members.items():
            if data is None:
                info = tarfile.TarInfo(name=name)
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                info = tarfile.TarInfo(name=name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    buf.seek(0)
    return buf.read()


# ===========================================================================
# GET bundle
# ===========================================================================


class TestBundle:
    async def test_bundle_returns_tar_stream_excluding_runtime(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        (spec_root / ".runtime").mkdir()
        (spec_root / ".runtime" / "cache.log").write_text("cache", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/x-tar"
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            names = tf.getnames()
            assert "docs/A.md" in names or "docs" in names
            # No member path should contain .runtime
            for n in names:
                assert ".runtime" not in n.split("/"), f"runtime leaked into bundle: {n}"

    async def test_bundle_empty_spec_root(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "empty-root"  # does not exist yet
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/x-tar"
        # Valid (empty) tar — must be parseable
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            tf.getmembers()

    async def test_bundle_workspace_not_found(self, client: AsyncClient, auth_headers) -> None:
        resp = await client.get(
            f"/api/workspaces/{uuid.uuid4()}/spec-workspace/bundle",
            headers=auth_headers,
        )
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_SPEC_WORKSPACE_NOT_FOUND"


# ===========================================================================
# Bundle snapshot metadata（task-08 / FR-08 / design §7.3）
# ===========================================================================


class TestBundleMetadata:
    """task-08（2026-08-29-change-delete-closure-and-spec-pull）：快照元数据。

    - 响应头 ``X-Spec-Version`` = ``spec_ws.spec_version``（持包方不解包即可辨新旧）
    - tar 顶层 ``PLATFORM-BUNDLE.json`` 含 {spec_version, strategy, generated_at,
      server} 四键（离线可辨快照来源/时点）
    - ``.runtime/`` 与 local.yaml 任意深度排除零回归 + 元数据不落 spec_root 磁盘
    """

    async def test_bundle_x_spec_version_header_and_metadata(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        import json
        from datetime import datetime

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        # 排除项素材：顶层 .runtime + 嵌套 .runtime + 顶层/嵌套 local.yaml
        (spec_root / ".runtime").mkdir()
        (spec_root / ".runtime" / "cache.log").write_text("cache", encoding="utf-8")
        (spec_root / "changes").mkdir()
        (spec_root / "changes" / "c1" / ".runtime").mkdir(parents=True)
        (spec_root / "changes" / "c1" / ".runtime" / "x.db").write_text("db", encoding="utf-8")
        (spec_root / "local.yaml").write_text("token: top", encoding="utf-8")
        (spec_root / "changes" / "c1" / "local.yaml").write_text("token: nested", encoding="utf-8")
        await _make_spec_workspace(
            db_session, ws, spec_root, strategy="repo-mirrored", spec_version=12
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        assert resp.headers["x-spec-version"] == "12"
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            names = tf.getnames()
            # 顶层字面成员（非嵌套同名）
            assert "PLATFORM-BUNDLE.json" in names
            assert not any(
                n != "PLATFORM-BUNDLE.json" and n.endswith("PLATFORM-BUNDLE.json") for n in names
            )
            raw = tf.extractfile("PLATFORM-BUNDLE.json")
            assert raw is not None
            meta = json.loads(raw.read())
        assert set(meta) == {"spec_version", "strategy", "generated_at", "server"}
        assert meta["spec_version"] == 12
        assert meta["strategy"] == "repo-mirrored"
        datetime.fromisoformat(str(meta["generated_at"]))  # 打包时刻 UTC ISO 可解析
        assert isinstance(meta["server"], str) and meta["server"]

        # 排除零回归：.runtime 任意深度 / local.yaml 任意深度不出服务器
        for n in names:
            assert ".runtime" not in n.split("/"), f"runtime leaked into bundle: {n}"
            assert n.rsplit("/", 1)[-1] != "local.yaml", f"local.yaml leaked: {n}"
        assert "docs/A.md" in names

        # 元数据仅存在于 tar 流内，spec_root 磁盘零残留（镜像树不被污染）
        assert not (spec_root / "PLATFORM-BUNDLE.json").exists()


# ===========================================================================
# POST sync
# ===========================================================================


class TestSync:
    async def test_sync_overwrites_and_reparses(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("old", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        # New tar with only docs/B.md
        tar_bytes = _build_tar(
            {
                "docs": None,
                "docs/B.md": b"# B",
            }
        )

        # Mock reparse to avoid needing a real parser setup; return parsed=1
        with patch(
            "app.modules.scan_docs.service.ScanDocsService.reparse",
            new=AsyncMock(
                return_value=({"parsed": 1, "created": 1, "updated": 0, "deleted": 0}, None)
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/sync",
                headers={**auth_headers, "Content-Type": "application/x-tar"},
                content=tar_bytes,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        # D-003：apply_sync 现返回 {reparsed_docs, reparsed_changes}；sync DTO 暴露两段
        # （reparsed=docs 向后兼容 + reparsed_changes；test spec_root 无 changes → 0）。
        assert body == {"ok": True, "reparsed": 1, "reparsed_changes": 0}

        # 2026-08-19-spec-mirror-tombstone-sync FR-01：tar 是整树权威快照——镜像里
        # tar 未包含的 A.md 被对账删除（软删 move 到备份区），幽灵文件不再残留；
        # tar 内的新文件正常落地。
        assert not (spec_root / "docs" / "A.md").exists()
        assert (spec_root / "docs" / "B.md").read_text(encoding="utf-8") == "# B"
        backup_root = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)
        backed = list(backup_root.rglob("docs/A.md"))
        assert len(backed) == 1, f"expected converged backup file, found {backed}"
        assert backed[0].read_text(encoding="utf-8") == "old"

    async def test_sync_skips_runtime_dir_from_tar(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / ".runtime").mkdir(parents=True)
        (spec_root / ".runtime" / "x.log").write_text("runtime-cache", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar(
            {
                "docs/C.md": b"# C",
                ".runtime/sillyspec.db": b"daemon-runtime-db",
            }
        )

        with patch(
            "app.modules.scan_docs.service.ScanDocsService.reparse",
            new=AsyncMock(
                return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/sync",
                headers={**auth_headers, "Content-Type": "application/x-tar"},
                content=tar_bytes,
            )

        assert resp.status_code == 200, resp.text
        # ql-20260813-007：.runtime 整树不入表/不落盘（sillyspec.db 是 SQLite 二进制含 NUL，
        # 写进 scan_documents 文本列曾触发 asyncpg 0x00 整批回滚 500）。spec 数据正常落地。
        assert (spec_root / "docs" / "C.md").read_bytes() == b"# C"
        # tar 内的 sillyspec.db 被跳过（未落 spec_root）。
        assert not (spec_root / ".runtime" / "sillyspec.db").exists()
        # spec_root 预存的 x.log 不在 merge 路径，保留。
        assert (spec_root / ".runtime" / "x.log").exists()

    async def test_sync_invalid_tar_422(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        (spec_root / "existing.md").write_text("keep", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=b"not a tar payload at all",
        )

        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        # spec_root untouched
        assert (spec_root / "existing.md").read_text(encoding="utf-8") == "keep"

    async def test_sync_rejects_absolute_path(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        (spec_root / "existing.md").write_text("keep", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"/etc/passwd": b"evil"})

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=tar_bytes,
        )

        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        # spec_root untouched
        assert (spec_root / "existing.md").exists()

    async def test_sync_rejects_path_traversal(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        (spec_root / "existing.md").write_text("keep", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"../../escape": b"evil"})

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=tar_bytes,
        )

        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        # Nothing escaped
        assert not (tmp_path / "escape").exists()
        assert (spec_root / "existing.md").exists()

    async def test_sync_workspace_not_found(self, client: AsyncClient, auth_headers) -> None:
        tar_bytes = _build_tar({"docs/X.md": b"# X"})
        resp = await client.post(
            f"/api/workspaces/{uuid.uuid4()}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=tar_bytes,
        )
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_SPEC_WORKSPACE_NOT_FOUND"


# Suppress unused-import warning for pytest (used for fixture discovery in some setups).
pytestmark = pytest.mark.asyncio


class TestBundleStreaming:
    """审计修复 P1-性能④：build_bundle 流式产出（有界内存 + 可取消）。

    旧实现整包攒 BytesIO 后再分块 yield——万级文件 workspace 内存峰值=整树
    字节，并发拉取成倍。新实现：后台线程打包（tarfile ``w|`` 流式模式）→
    有界队列背压 → 消费端逐块取；消费端提前关闭（客户端断连）时取消标志
    解除写线程阻塞并限时回收。
    """

    async def test_bundle_stream_chunked_and_content_valid(self, db_session, tmp_path) -> None:
        from app.modules.spec_workspace.service import SpecWorkspaceService

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        # 256KB 内容 → ≥4×64KB 分块，证流式分块真实发生（小树会整包一块）
        (spec_root / "docs" / "big.bin").write_bytes(bytes(range(256)) * 1024)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        await _make_spec_workspace(
            db_session, ws, spec_root, strategy="repo-mirrored", spec_version=7
        )

        service = SpecWorkspaceService(db_session)
        _, version, stream = await service.build_bundle(ws.id)
        assert version == 7

        chunks = list(stream)
        assert len(chunks) >= 4, "大树必须跨多个 64KB 块（整包缓冲则恒 1 块）"
        with tarfile.open(fileobj=io.BytesIO(b"".join(chunks)), mode="r:*") as tf:
            names = tf.getnames()
        assert "docs/big.bin" in names and "docs/A.md" in names
        assert "PLATFORM-BUNDLE.json" in names
        assert stream._cancelled.is_set(), "正常消费完毕后应走 close 清理路径"

    async def test_bundle_stream_cancel_unblocks_writer(self, db_session, tmp_path) -> None:
        from app.modules.spec_workspace.service import SpecWorkspaceService

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "big.bin").write_bytes(bytes(range(256)) * 1024)
        await _make_spec_workspace(db_session, ws, spec_root)

        service = SpecWorkspaceService(db_session)
        _, _, stream = await service.build_bundle(ws.id)
        first = next(iter(stream))
        assert first, "首个分块应立即可用（无需整包打包完成）"

        stream.close()  # 模拟客户端断连：消费端放弃
        assert stream._cancelled.is_set()
        thread = stream._thread
        assert thread is not None
        thread.join(timeout=5.0)
        assert not thread.is_alive(), "取消后写线程必须限时退出（取消检查在每次分片入队前）"
        stream.close()  # 幂等


class TestBundleStreamLeakWindow:
    """2026-08-30 审计⑦：finally put 撞满队 + close 竞态的线程泄漏窗口。"""

    async def test_finally_put_on_full_queue_with_close_race_recycled(self) -> None:
        """生产者恰在队列满时收尾 + 消费端 close——写线程必须被回收。

        构造：produce 写满队列（32×64KB）后返回，finally 的 outcome ``put`` 撞
        满队阻塞；主线程随后 close()。修复前顺序（先 ``done.set()`` 后 put）下
        close 的排空循环被 ``not done`` 挡住不排空 → put 无人解阻 → join 5s
        超时后线程永久阻塞（泄漏）；修复后（先 put 后 done）close 排空解阻，
        线程限时退出。
        """
        import time as _time

        from app.modules.spec_workspace.service import (
            _BUNDLE_QUEUE_MAX_CHUNKS,
            _BundleTarStream,
        )

        def produce(writer) -> None:
            writer.write(b"x" * (64 * 1024 * _BUNDLE_QUEUE_MAX_CHUNKS))

        stream = _BundleTarStream(produce)
        iter(stream)  # 启动写线程（迭代器本身由消费端 close 路径回收）
        deadline = _time.monotonic() + 5.0
        while stream._queue.qsize() < _BUNDLE_QUEUE_MAX_CHUNKS and _time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        assert stream._queue.qsize() == _BUNDLE_QUEUE_MAX_CHUNKS, "前置：队列应已写满"

        stream.close()  # 消费端放弃（与 finally put 并发竞态）

        thread = stream._thread
        assert thread is not None
        thread.join(timeout=6.0)
        assert not thread.is_alive(), "满队收尾 + close 竞态下写线程必须限时回收（修复前死锁泄漏）"

    async def test_iter_bundle_stream_closes_on_aclose(self) -> None:
        """async 包装：消费端提前 aclose（客户端断连同构）→ finally 显式 close，
        线程回收（starlette 1.1.0 不调同步迭代器 close，本包装是清理入口）。"""
        from app.modules.spec_workspace.service import _BundleTarStream, iter_bundle_stream

        stream = _BundleTarStream(lambda w: w.write(b"y" * 300_000))
        agen = iter_bundle_stream(stream)
        first = await agen.__anext__()
        assert first
        await agen.aclose()  # 触发生成器 finally → to_thread(close)
        assert stream._closed
        thread = stream._thread
        assert thread is not None
        thread.join(timeout=5.0)
        assert not thread.is_alive()


# ===========================================================================
# Bundle gzip 协商传输（ql-20260904-016 会话首响优化）
# ===========================================================================


class TestBundleGzip:
    """Accept-Encoding 含 gzip 时流式 gzip（w|gz + Content-Encoding），语义不变。

    背景：36MB 文本 spec 树经 Docker Desktop localhost 端口转发 ~2.4MB/s，daemon
    30s fetch 超时被打穿（会话 f0f76381 实证 pull 恒失败）。gzip 后 ~6MB 回秒级；
    浏览器/undici/httpx 均按 Content-Encoding 透明解压，明文 tar 语义不变。
    """

    async def test_build_bundle_gzip_roundtrip_and_smaller(self, db_session, tmp_path) -> None:
        import gzip as gzip_mod

        from app.modules.spec_workspace.service import SpecWorkspaceService

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        # 高度可压缩文本（真实 spec 树为 markdown/JSON 文本）
        (spec_root / "docs" / "big.md").write_text(
            "# spec\n" + "内容行\n" * 20000, encoding="utf-8"
        )
        await _make_spec_workspace(db_session, ws, spec_root)

        service = SpecWorkspaceService(db_session)
        _, _, plain_stream = await service.build_bundle(ws.id)
        plain = b"".join(list(plain_stream))
        _, _, gz_stream = await service.build_bundle(ws.id, gzip_output=True)
        gz = b"".join(list(gz_stream))

        # gzip magic（1f 8b）且显著小于明文
        assert gz[:2] == b"\x1f\x8b"
        assert len(gz) < len(plain) * 0.2, "文本树 gzip 后应缩到 20% 以下"

        # 解压后与明文 tar 成员一致（快照元数据成员同样在）
        with tarfile.open(fileobj=io.BytesIO(gzip_mod.decompress(gz)), mode="r:*") as tf:
            gz_names = set(tf.getnames())
        with tarfile.open(fileobj=io.BytesIO(plain), mode="r:*") as tf:
            plain_names = set(tf.getnames())
        assert gz_names == plain_names
        assert "PLATFORM-BUNDLE.json" in gz_names
        assert "docs/big.md" in gz_names

    async def test_router_gzip_negotiation(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        # 显式带 gzip → Content-Encoding: gzip（httpx 透明解压后 content 仍是合法 tar）
        resp_gz = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers={**auth_headers, "accept-encoding": "gzip"},
        )
        assert resp_gz.status_code == 200, resp_gz.text
        assert resp_gz.headers.get("content-encoding") == "gzip"
        assert resp_gz.headers.get("vary") == "Accept-Encoding"
        with tarfile.open(fileobj=io.BytesIO(resp_gz.content), mode="r:*") as tf:
            assert "docs/A.md" in tf.getnames()

        # identity → 明文 tar，无 Content-Encoding（老客户端零变化）
        resp_plain = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers={**auth_headers, "accept-encoding": "identity"},
        )
        assert resp_plain.status_code == 200, resp_plain.text
        assert "content-encoding" not in resp_plain.headers
        with tarfile.open(fileobj=io.BytesIO(resp_plain.content), mode="r:*") as tf:
            assert "docs/A.md" in tf.getnames()

    async def test_build_bundle_gzip_cached_on_second_call(self, db_session, tmp_path) -> None:
        """ql-20260904-016：gzip 变体按 (ws, spec_version) 缓存——二次拉取命中字节
        缓存（零打包零 bind mount 读），plain 变体不入缓存。"""
        from app.modules.spec_workspace import service as spec_svc

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root, spec_version=3)

        spec_svc._bundle_gzip_cache.clear()
        service = spec_svc.SpecWorkspaceService(db_session)

        _, _, s1 = await service.build_bundle(ws.id, gzip_output=True)
        first = b"".join(list(s1))
        # 完整消费后缓存应落位
        assert (ws.id, 3) in spec_svc._bundle_gzip_cache

        # 二次构建：命中缓存，字节与首次一致（generated_at 固化为首包时刻）
        _, _, s2 = await service.build_bundle(ws.id, gzip_output=True)
        second = b"".join(list(s2))
        assert second == first

        # plain 变体不缓存（内存边界：仅 gzip 入缓存）
        n_before = len(spec_svc._bundle_gzip_cache)
        _, _, _plain = await service.build_bundle(ws.id, gzip_output=False)
        list(_plain)
        assert len(spec_svc._bundle_gzip_cache) == n_before
        assert all(k[0] == ws.id for k in spec_svc._bundle_gzip_cache)
