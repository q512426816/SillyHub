"""alembic 版本图守护：迁移链必须单头、引用闭合、revision 唯一。

背景（2026-09-13 24h 审查）：并行变更各自挂迁移但 down_revision 接错基线，
两周内两次产生双头（2026-09-12 b6fb75dee 的 20260910130000 从 5e295549e20f
再分叉，与 20260912110000 并存；更早 6756e634f119 同类，见 local.yaml
known_failures D 段沿革）。双头下 ``alembic upgrade head`` 直接报 Multiple
head revisions，而 deploy/docker-compose.yml 启动命令即 ``alembic upgrade
head && exec uvicorn ...``——后端容器起不来，且测试建表走 metadata 不走
迁移链，CI 拦不住。本守护用 AST 静态解析 versions/*.py（不 import 迁移
模块、不连库，快且无副作用）。

规则：
- revision 标识全目录唯一；
- down_revision（str / tuple / None）引用的 revision 必须存在（防手滑改号
  悬空）；
- 无后继引用的 head 恰好一个。
"""

from __future__ import annotations

import ast
from pathlib import Path

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "migrations" / "versions"


def _load_revisions() -> list[tuple[str, str | tuple[str, ...] | None, str]]:
    """解析全部迁移文件的 (revision, down_revision, 文件名)。

    AST 取模块级赋值字面量——down_revision 可能是 str、tuple（merge）或 None。
    """
    assert VERSIONS_DIR.is_dir(), f"迁移目录不存在: {VERSIONS_DIR}"
    files = sorted(VERSIONS_DIR.glob("*.py"))
    assert files, "迁移目录为空——守护测试自身失效"
    rows: list[tuple[str, str | tuple[str, ...] | None, str]] = []
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        rev: str | None = None
        down: str | tuple[str, ...] | None = None
        # 两种模块级赋值形态都要接：老模板 ``revision = "x"``（ast.Assign）与
        # 新模板 ``revision: str = "x"``（ast.AnnAssign，20260912050000 起在用）。
        assigns: list[tuple[str, ast.expr]] = []
        for node in tree.body:
            if isinstance(node, ast.Assign):
                assigns.extend((t.id, node.value) for t in node.targets if isinstance(t, ast.Name))
            elif (
                isinstance(node, ast.AnnAssign)
                and isinstance(node.target, ast.Name)
                and node.value is not None
            ):
                assigns.append((node.target.id, node.value))
        for name, value in assigns:
            try:
                literal = ast.literal_eval(value)
            except ValueError:
                continue
            if name == "revision" and isinstance(literal, str):
                rev = literal
            elif name == "down_revision":
                down = literal
        if rev is None:
            continue  # 非迁移辅助模块（如 __init__）无 revision
        rows.append((rev, down, path.name))
    return rows


def test_migration_revisions_unique() -> None:
    rows = _load_revisions()
    assert len(rows) >= 2, "至少应有多个迁移文件（守护自身健全性）"
    seen: dict[str, str] = {}
    for rev, _down, filename in rows:
        assert rev not in seen, f"revision {rev!r} 重复定义：{seen[rev]} 与 {filename}"
        seen[rev] = filename


def test_migration_graph_single_head_and_closed_refs() -> None:
    rows = _load_revisions()
    known = {rev for rev, _down, _filename in rows}
    referenced: set[str] = set()
    for _rev, down, filename in rows:
        parents = down if isinstance(down, tuple) else ((down,) if down else ())
        for parent in parents:
            assert parent in known, (
                f"{filename} 的 down_revision={parent!r} 不存在于版本目录（悬空引用）"
            )
            referenced.add(parent)
    heads = sorted(known - referenced)
    assert len(heads) == 1, (
        f"alembic 多头（{len(heads)} 个）：{heads}——deploy compose 启动命令"
        " `alembic upgrade head` 会直接失败；新迁移的 down_revision 必须接当前"
        " head，并行迁移须补 merge revision（先例 1d763051eb15 / c97f3be457e6）"
    )
