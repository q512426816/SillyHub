"""Unit tests for the knowledge parser."""

from __future__ import annotations

from pathlib import Path

from app.modules.knowledge.parser import KnowledgeParser, parse_md_directory, parse_quick_entries


def test_parse_knowledge_with_files(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "INDEX.md").write_text(
        "# Knowledge Index\n\nSome index text.", encoding="utf-8"
    )
    (knowledge_dir / "cors.md").write_text("# CORS Notes\n\nCross-origin stuff.", encoding="utf-8")

    entries = parse_md_directory(knowledge_dir, tmp_path, ".sillyspec/knowledge")
    assert len(entries) == 2
    filenames = [e.filename for e in entries]
    assert "INDEX.md" in filenames
    assert "cors.md" in filenames
    idx_entry = next(e for e in entries if e.filename == "INDEX.md")
    assert idx_entry.title == "Knowledge Index"
    cors_entry = next(e for e in entries if e.filename == "cors.md")
    assert "CORS" in (cors_entry.content or "")


def test_parse_empty_directory(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    entries = parse_md_directory(knowledge_dir, tmp_path, ".sillyspec/knowledge")
    assert entries == []


def test_parse_nonexistent_directory(tmp_path: Path) -> None:
    entries = parse_md_directory(tmp_path / "nope", tmp_path, ".sillyspec/knowledge")
    assert entries == []


def test_parse_knowledge_recursive_with_zones(tmp_path: Path) -> None:
    """task-01（2026-09-17-knowledge-precipitation / D-004@v1）：parse_knowledge
    递归 rglob 扫子目录，zone 由 filename 首段派生，四值全覆盖。"""
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "generated").mkdir()
    (knowledge_dir / "proposed").mkdir()
    (knowledge_dir / "INDEX.md").write_text("# Index\nTop level.", encoding="utf-8")
    (knowledge_dir / "decisions" / "daemon.md").write_text("# 决策\nD-001", encoding="utf-8")
    (knowledge_dir / "generated" / "daemon-client.md").write_text("# 自动\nG", encoding="utf-8")
    (knowledge_dir / "proposed" / "agent-proposal.md").write_text("# 候选\nP", encoding="utf-8")

    entries = parser.parse_knowledge(tmp_path)
    assert len(entries) == 4
    by_filename = {e.filename: e for e in entries}
    assert set(by_filename) == {
        "INDEX.md",
        "decisions/daemon.md",
        "generated/daemon-client.md",
        "proposed/agent-proposal.md",
    }
    # zone 由 filename 首段派生：decisions/generated/proposed 之外归 top
    assert by_filename["INDEX.md"].zone == "top"
    assert by_filename["decisions/daemon.md"].zone == "decisions"
    assert by_filename["generated/daemon-client.md"].zone == "generated"
    assert by_filename["proposed/agent-proposal.md"].zone == "proposed"
    # path 保留 .sillyspec/knowledge/ 前缀拼完整相对路径
    assert by_filename["INDEX.md"].path == ".sillyspec/knowledge/INDEX.md"
    assert by_filename["decisions/daemon.md"].path == ".sillyspec/knowledge/decisions/daemon.md"
    assert (
        by_filename["generated/daemon-client.md"].path
        == ".sillyspec/knowledge/generated/daemon-client.md"
    )
    assert (
        by_filename["proposed/agent-proposal.md"].path
        == ".sillyspec/knowledge/proposed/agent-proposal.md"
    )
    # 子目录条目标题仍取正文第一个 # 行
    assert by_filename["decisions/daemon.md"].title == "决策"


def test_parse_knowledge_top_level_values_regression(tmp_path: Path) -> None:
    """回归断言：顶层条目 filename 与 path 值和改造前逐字一致（D-007@v1 兼容承诺）。"""
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "INDEX.md").write_text("# Knowledge Index\n\n> Reference.", encoding="utf-8")
    (knowledge_dir / "cors.md").write_text("# CORS Notes\n\nCross-origin stuff.", encoding="utf-8")
    # 加子目录证明递归不污染顶层条目取值
    (knowledge_dir / "decisions").mkdir()
    (knowledge_dir / "decisions" / "d.md").write_text("# D", encoding="utf-8")

    entries = parser.parse_knowledge(tmp_path)
    by_filename = {e.filename: e for e in entries}
    # 顶层条目 filename 仍是裸文件名（不含子目录段），path 前缀/拼接格式不变
    top = by_filename["INDEX.md"]
    assert top.filename == "INDEX.md"
    assert top.path == ".sillyspec/knowledge/INDEX.md"
    assert top.zone == "top"
    top2 = by_filename["cors.md"]
    assert top2.filename == "cors.md"
    assert top2.path == ".sillyspec/knowledge/cors.md"
    # 子目录条目按含子目录段的 filename 呈现
    assert by_filename["decisions/d.md"].filename == "decisions/d.md"
    assert by_filename["decisions/d.md"].path == ".sillyspec/knowledge/decisions/d.md"


def test_cross_zone_same_name_filenames_stay_unique(tmp_path: Path) -> None:
    """跨目录同名文件：含子目录段的 filename 值天然唯一（get 精确匹配无歧义）。"""
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "notes.md").write_text("# Top Notes", encoding="utf-8")
    (knowledge_dir / "decisions" / "notes.md").write_text("# Decision Notes", encoding="utf-8")

    entries = parser.parse_knowledge(tmp_path)
    by_filename = {e.filename: e for e in entries}
    assert set(by_filename) == {"notes.md", "decisions/notes.md"}
    assert by_filename["notes.md"].title == "Top Notes"
    assert by_filename["notes.md"].zone == "top"
    assert by_filename["decisions/notes.md"].title == "Decision Notes"
    assert by_filename["decisions/notes.md"].zone == "decisions"


def test_parse_quicklog_stays_non_recursive(tmp_path: Path) -> None:
    """quicklog 解析零改动：子目录条目不进入解析结果，filename 仍为裸文件名。"""
    parser = KnowledgeParser()
    quicklog_dir = tmp_path / "quicklog"
    (quicklog_dir / "sub").mkdir(parents=True)
    (quicklog_dir / "2026-01-15.md").write_text("# Quicklog\nTop", encoding="utf-8")
    (quicklog_dir / "sub" / "nested.md").write_text("# Nested", encoding="utf-8")

    entries = parser.parse_quicklog(tmp_path)
    assert [e.filename for e in entries] == ["2026-01-15.md"]
    assert entries[0].path == ".sillyspec/quicklog/2026-01-15.md"


def test_parse_md_directory_default_not_recursive(tmp_path: Path) -> None:
    """parse_md_directory 开关默认关：直接调用（既有 quicklog/测试路径）不递归。"""
    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "top.md").write_text("# Top", encoding="utf-8")
    (knowledge_dir / "decisions" / "d.md").write_text("# D", encoding="utf-8")

    entries = parse_md_directory(knowledge_dir, tmp_path, ".sillyspec/knowledge")
    assert [e.filename for e in entries] == ["top.md"]
    assert entries[0].path == ".sillyspec/knowledge/top.md"


def test_knowledge_parser_convenience_methods(tmp_path: Path) -> None:
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "test.md").write_text("# Test\nContent", encoding="utf-8")

    quicklog_dir = tmp_path / "quicklog"
    quicklog_dir.mkdir()
    (quicklog_dir / "log.md").write_text("# Log\nEntry", encoding="utf-8")

    k_entries = parser.parse_knowledge(tmp_path)
    assert len(k_entries) == 1
    assert k_entries[0].filename == "test.md"

    q_entries = parser.parse_quicklog(tmp_path)
    assert len(q_entries) == 1
    assert q_entries[0].filename == "log.md"


def test_path_traversal_rejected(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    (outside_dir / "evil.md").write_text("# Evil\nContent", encoding="utf-8")

    entries = parse_md_directory(outside_dir, knowledge_dir, ".sillyspec/knowledge")
    assert entries == []


def test_read_file_safe_small_file(tmp_path: Path) -> None:
    from app.modules.knowledge.parser import _read_file_safe

    f = tmp_path / "small.md"
    f.write_text("# Small\nContent", encoding="utf-8")
    content, truncated = _read_file_safe(f)
    assert truncated is False
    assert content == "# Small\nContent"


def test_read_file_safe_large_file_truncates_without_full_read(tmp_path: Path) -> None:
    """超大文件只读取前 MAX_CONTENT_BYTES // 4 字节，不整文件读入内存（OOM 防护）。"""
    from app.modules.knowledge.parser import MAX_CONTENT_BYTES, _read_file_safe

    f = tmp_path / "large.md"
    # 纯 ASCII（1 字节 = 1 字符），超过 MAX_CONTENT_BYTES
    f.write_bytes(b"a" * (MAX_CONTENT_BYTES + 100))
    content, truncated = _read_file_safe(f)
    limit = MAX_CONTENT_BYTES // 4
    assert truncated is True
    # 只读了前 limit 字节，而不是整文件后再切片
    assert len(content) == limit


# ---------------------------------------------------------------------------
# quick-2dba0118（沉淀弹层三修之一）：quicklog 条目级解析 parse_quick_entries
# ---------------------------------------------------------------------------


def test_parse_quick_entries_single_file_multi_sections(tmp_path: Path) -> None:
    """单文件多条目：`## <ql-id> | 日期 | 标题` 节头逐条提取（ref/title/date）。

    quicklog 真实形态是 QUICKLOG-*.md 单文件内多条 `## ql-...` 节（服务器实证，
    一个文件 17 条）——旧式无后缀 ref、非 ql 节头、两段头一律不匹配。"""
    quicklog_dir = tmp_path / "quicklog"
    quicklog_dir.mkdir()
    (quicklog_dir / "QUICKLOG-demo.md").write_text(
        "\n".join(
            [
                "# QUICKLOG",
                "",
                "## ql-20260918-001-a1b2 | 2026-09-18 09:00:00 | 第一修：登录超时",
                "状态：已完成",
                "",
                "## ql-20260918-002-c3d4 | 2026-09-18 21:30:00 | 第二修：乱码守卫",
                "状态：已完成",
                "",
                "## 2026-09-18 22:00:00 — 旧式时间戳节头（无 ql-id，不匹配）",
                "",
                "## ql-20260706-003 | 2026-07-06 03:10:00 | 旧式无后缀（不匹配）",
                "",
                "正文里的 `## ql-20260918-003-eeee | d | t` 缩进行不匹配（锚定行首）",
            ]
        ),
        encoding="utf-8",
    )

    entries = parse_quick_entries(tmp_path)
    assert [(e.ref, e.title, e.date) for e in entries] == [
        ("ql-20260918-002-c3d4", "第二修：乱码守卫", "2026-09-18 21:30:00"),
        ("ql-20260918-001-a1b2", "第一修：登录超时", "2026-09-18 09:00:00"),
    ]


def test_parse_quick_entries_dedup_case_tolerant_and_newest_first(tmp_path: Path) -> None:
    """跨文件按 ref 去重（较新文件副本优先）+ 大小写容忍 + ref 倒序最新在前；
    非 QUICKLOG- 前缀文件与子目录不进条目视图。"""
    quicklog_dir = tmp_path / "quicklog"
    quicklog_dir.mkdir()
    (quicklog_dir / "QUICKLOG-a.md").write_text(
        "## ql-20260918-001-dup | 2026-09-18 08:00:00 | 旧文件副本\n"
        "## ql-20260917-001-old | 2026-09-17 08:00:00 | 旧文件条目\n",
        encoding="utf-8",
    )
    # 文件名倒序较新（QUICKLOG-b > QUICKLOG-a）：同 ref 副本以本文件为准。
    (quicklog_dir / "QUICKLOG-b.md").write_text(
        "## ql-20260918-001-dup | 2026-09-18 08:00:00 | 新文件副本\n"
        "## ql-20260919-001-new | 2026-09-19 08:00:00 | 新条目\n",
        encoding="utf-8",
    )
    # 大小写容忍：小写 quicklog- 前缀同收。
    (quicklog_dir / "quicklog-c.md").write_text(
        "## ql-20260916-001-low | 2026-09-16 08:00:00 | 小写文件名条目\n",
        encoding="utf-8",
    )
    # 非 QUICKLOG 前缀（旧式独立条目文件）不扫。
    (quicklog_dir / "ql-20260101-001-x.md").write_text(
        "## ql-20260101-001-x | 2026-01-01 08:00:00 | 独立文件条目\n", encoding="utf-8"
    )
    # 子目录不递归。
    (quicklog_dir / "sub").mkdir()
    (quicklog_dir / "sub" / "QUICKLOG-nested.md").write_text(
        "## ql-20260102-001-n | 2026-01-02 08:00:00 | 嵌套条目\n", encoding="utf-8"
    )

    entries = parse_quick_entries(tmp_path)
    assert [e.ref for e in entries] == [
        "ql-20260919-001-new",
        "ql-20260918-001-dup",
        "ql-20260917-001-old",
        "ql-20260916-001-low",
    ]
    dup = next(e for e in entries if e.ref == "ql-20260918-001-dup")
    assert dup.title == "新文件副本"


def test_parse_quick_entries_missing_or_empty_dir(tmp_path: Path) -> None:
    """quicklog 目录不存在 / 存在但无 QUICKLOG-*.md → 空列表。"""
    assert parse_quick_entries(tmp_path) == []

    quicklog_dir = tmp_path / "quicklog"
    quicklog_dir.mkdir()
    (quicklog_dir / "notes.md").write_text("## ql-20260101-001-x | d | t\n", encoding="utf-8")
    assert parse_quick_entries(tmp_path) == []


# ---------------------------------------------------------------------------
# 2026-09-20-knowledge-effect-panel task-01：fr zone + 条目全集 parse_knowledge_entries
# ---------------------------------------------------------------------------


def test_zone_fr_derived(tmp_path: Path) -> None:
    """fr/ 子目录条目归独立 fr zone（D-005@v1「需求规则」组数据源）。"""
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "fr").mkdir(parents=True)
    (knowledge_dir / "fr" / "host-fs-handler.md").write_text("# FR\n正文", encoding="utf-8")

    entries = parser.parse_knowledge(tmp_path)
    assert [(e.filename, e.zone) for e in entries] == [("fr/host-fs-handler.md", "fr")]


def test_slugify_anchor_calibrated_against_real_hits_samples() -> None:
    """slugify 复刻 CLI INDEX/hits 锚点形态——以本仓 knowledge-hits.jsonl 实测
    锚点 + 当前知识树标题逐字校准（双端归一的救命项，Grill CLK-02）：

    - 空白每个转一个 ``-``（不折叠 run、不去首尾）：``无 --reload`` → ``无---reload``；
    - 括号/箭头/斜杠/点/emoji 去除（无痕消失，两侧空格的 ``-`` 留存成 ``--``）；
    - 保留字母/数字/下划线/中文/连字符；不截断。
    """
    from app.modules.knowledge.parser import slugify_anchor

    assert (
        slugify_anchor(
            "Backend 模块分层与基类异常约定（Router/Service/Schema → BaseModel → AppError）"
        )
        == "backend-模块分层与基类异常约定routerserviceschema--basemodel--apperror"
    )
    assert (
        slugify_anchor("🟡 Docker backend 容器不热重载（挂载非 /app、无 --reload）")
        == "-docker-backend-容器不热重载挂载非-app无---reload"
    )
    assert (
        slugify_anchor("🟢 daemon 重启 session 恢复已修复（gap-8.3 / commit 40e21d3）")
        == "-daemon-重启-session-恢复已修复gap-83--commit-40e21d3"
    )
    # 下划线保留（item_id 实测锚）；emoji 开头去后遗留前导 -（不去首尾）
    assert slugify_anchor("PPM 导出 export-excel 路由必须前置于 item_id 路由") == (
        "ppm-导出-export-excel-路由必须前置于-item_id-路由"
    )
    # 点号去除（多数实测样本：gap-8.3→gap-83 / model.py→modelpy / daemon.ts→daemonts）。
    # 注：INDEX.md#L47 手写行锚 ``硬钉-0-3-181`` 与规则推导 ``硬钉-03181`` 不一致
    # （手写行 display 与小节标题本就漂移）——R-03 计数 misses 容忍的已知样本。
    assert slugify_anchor(
        "🟡 daemon pnpm overrides 把 claude-agent-sdk 8 平台二进制硬钉 0.3.181"
    ) == ("-daemon-pnpm-overrides-把-claude-agent-sdk-8-平台二进制硬钉-03181")


def test_parse_knowledge_entries_three_shapes(tmp_path: Path) -> None:
    """条目全集三类形态：手册 ## 小节（文件#slug）/ decisions+fr 条目（裸文件、
    共享锚、title 去 ID 段）/ generated 文件级；INDEX.md 任何 zone 排除、
    proposed 不入全集、frontmatter created_at/generated_at 解析。"""
    from datetime import UTC, datetime

    from app.modules.knowledge.parser import parse_knowledge_entries

    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "fr").mkdir()
    (knowledge_dir / "generated").mkdir()
    (knowledge_dir / "proposed").mkdir()

    (knowledge_dir / "INDEX.md").write_text(
        "# Index\n\n## Patterns\n\n- k → [conventions.md#提交规范](x)\n", encoding="utf-8"
    )
    (knowledge_dir / "conventions.md").write_text(
        "---\ncreated_at: 2026-01-01T00:00:00Z\n---\n"
        "# Conventions\n\n## 提交规范\n\n正文\n\n## 目录约定\n\n正文\n",
        encoding="utf-8",
    )
    (knowledge_dir / "decisions" / "backend.md").write_text(
        "# 决策\n\n## D-001@v1 用 links 表\n状态：implemented\n\n## D-002@v1\n状态：implemented\n",
        encoding="utf-8",
    )
    (knowledge_dir / "fr" / "host-fs-handler.md").write_text(
        "---\ncreated_at: 2026-09-19T15:24:52Z\n---\n"
        "# FR 索引\n\n## FR-host-fs-handler-001 会话样式回放主体\n状态：superseded\n",
        encoding="utf-8",
    )
    (knowledge_dir / "generated" / "runtime.md").write_text(
        "---\ngenerated_at: 2026-07-11T16:26:25Z\n---\n# Runtime\n正文\n", encoding="utf-8"
    )
    (knowledge_dir / "generated" / "INDEX.md").write_text("# Gen Index\n", encoding="utf-8")
    (knowledge_dir / "proposed" / "pending.md").write_text("# 候选\n", encoding="utf-8")

    entries = parse_knowledge_entries(tmp_path)
    by_anchor: dict[str, list] = {}
    for e in entries:
        by_anchor.setdefault(e.anchor, []).append(e)

    # 手册：每 ## 小节一条，anchor=文件#slug，created_at 取 frontmatter
    assert set(by_anchor) == {
        "conventions.md#提交规范",
        "conventions.md#目录约定",
        "decisions/backend.md",
        "fr/host-fs-handler.md",
        "generated/runtime.md",
    }
    conv = by_anchor["conventions.md#提交规范"][0]
    assert (conv.title, conv.file, conv.zone) == ("提交规范", "conventions.md", "top")
    assert conv.created_at == datetime(2026, 1, 1, tzinfo=UTC)

    # decisions：共享裸文件锚 + title 去 ID 段（纯 ID 无标题回落 ID 本身）
    decision_titles = [e.title for e in by_anchor["decisions/backend.md"]]
    assert decision_titles == ["用 links 表", "D-002@v1"]
    assert all(
        e.zone == "decisions" and e.created_at is None for e in by_anchor["decisions/backend.md"]
    )

    # fr：条目级共享裸文件锚 + frontmatter created_at
    fr_entry = by_anchor["fr/host-fs-handler.md"][0]
    assert fr_entry.title == "会话样式回放主体"
    assert fr_entry.zone == "fr"
    assert fr_entry.created_at == datetime(2026, 9, 19, 15, 24, 52, tzinfo=UTC)

    # generated：文件级一条，created_at 取 generated_at 键
    gen = by_anchor["generated/runtime.md"][0]
    assert (gen.title, gen.zone) == ("Runtime", "generated")
    assert gen.created_at == datetime(2026, 7, 11, 16, 26, 25, tzinfo=UTC)


def test_parse_knowledge_entries_empty_and_missing_root(tmp_path: Path) -> None:
    """knowledge 目录不存在 / 空目录 → 空条目全集。"""
    from app.modules.knowledge.parser import parse_knowledge_entries

    assert parse_knowledge_entries(tmp_path) == []

    (tmp_path / "knowledge").mkdir()
    assert parse_knowledge_entries(tmp_path) == []
