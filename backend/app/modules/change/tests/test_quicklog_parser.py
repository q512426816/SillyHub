"""quicklog_parser 单测（task-03 / design §8 解析器单测）。

样本取自本仓 ``.sillyspec/quicklog/`` 真实形态切片（2026-08-16 实查）：
CRLF 行尾、全半角冒号、4 状态形态、单行多分隔符文件行、bullet 括注（含
``(dashboard)`` 嵌套陷阱）、空壳占位、重复状态行、白名单正则、轮转文件。
"""

from __future__ import annotations

from pathlib import Path

from app.modules.change.quicklog_parser import (
    QuicklogFileEntry,
    QuicklogFileRef,
    parse_quicklog_directory,
)


def _write(path: Path, text: str) -> None:
    """按真实文件形态写 CRLF 行尾。"""
    path.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))


def _entry(entries: list[QuicklogFileEntry], ql_id: str) -> QuicklogFileEntry:
    return next(e for e in entries if e.ql_id == ql_id)


def test_missing_directory_returns_empty(tmp_path: Path) -> None:
    assert parse_quicklog_directory(tmp_path / "quicklog") == []


def test_empty_directory_returns_empty(tmp_path: Path) -> None:
    (tmp_path / "quicklog").mkdir()
    assert parse_quicklog_directory(tmp_path / "quicklog") == []


def test_basic_completed_entry_fullwidth_labels(tmp_path: Path) -> None:
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "\n"
        "## ql-20260812-007-d086 | 2026-08-12 20:43:59 | 修 daemon preflight 启动卡死\n"
        "状态：已完成\n"
        "关联变更：（无）\n"
        "文件：sillyhub-daemon/src/preflight.ts, sillyhub-daemon/tests/preflight.test.ts\n"
        "需求：修 preflight 卡死。\n"
        "根因：execSync timeout 杀不掉孙进程。\n"
        "方案：spawn+taskkill /T。\n"
        "结果：17 测试绿。\n",
    )
    entries = parse_quicklog_directory(ql)
    assert len(entries) == 1
    e = entries[0]
    assert e.ql_id == "ql-20260812-007-d086"
    assert e.title == "修 daemon preflight 启动卡死"
    assert e.status == "completed"
    assert e.status_note is None
    assert e.placeholder is False
    assert e.author_raw == "qinyi"
    assert e.linked_changes == []
    assert e.files == [
        QuicklogFileRef(path="sillyhub-daemon/src/preflight.ts"),
        QuicklogFileRef(path="sillyhub-daemon/tests/preflight.test.ts"),
    ]
    assert e.body_sections["需求"] == "修 preflight 卡死。"
    assert e.body_sections["根因"] == "execSync timeout 杀不掉孙进程。"
    assert e.body_sections["方案"] == "spawn+taskkill /T。"
    assert e.body_sections["结果"] == "17 测试绿。"
    assert e.source_file == "QUICKLOG-qinyi.md"
    assert "## ql-20260812-007-d086" in e.raw_block


def test_completed_with_note_extraction(tmp_path: Path) -> None:
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi-2026-07-05.md",
        "## ql-20260705-002-1111 | 2026-07-05 10:00:00 | 修复登录明文密码\n"
        "状态：已完成（commit 5f39f496，已 push main）\n"
        "文件：backend/app/modules/auth/router.py\n"
        "结果：全量绿。\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260705-002-1111")
    assert e.status == "completed"
    assert e.status_note == "commit 5f39f496，已 push main"
    assert e.author_raw == "qinyi"  # 日切文件名剥日期段


def test_partial_done_with_note(tmp_path: Path) -> None:
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi-2026-07-05.md",
        "## ql-20260705-003-2222 | 2026-07-05 11:00:00 | install.sh 修复\n"
        "状态：已暂存（git add install.sh，未 commit；本机 .cmd 已手工修可立即用）\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260705-003-2222")
    assert e.status == "partial_done"
    assert e.status_note == "git add install.sh，未 commit；本机 .cmd 已手工修可立即用"


def test_in_progress_and_placeholder(tmp_path: Path) -> None:
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-WhaleFall.md",
        "## ql-20260624-001-aaaa | 2026-06-24 09:00:00 | (quick 任务)\n"
        "状态：进行中\n"
        "## ql-20260624-002-bbbb | 2026-06-24 10:00:00 | 会话分流改造\n"
        "状态：进行中\n",
    )
    entries = parse_quicklog_directory(ql)
    a = _entry(entries, "ql-20260624-001-aaaa")
    assert a.placeholder is True
    assert a.status == "in_progress"
    assert a.title == "(quick 任务)"
    b = _entry(entries, "ql-20260624-002-bbbb")
    assert b.placeholder is False
    assert b.status == "in_progress"
    assert b.author_raw == "WhaleFall"


def test_duplicate_status_lines_take_last(tmp_path: Path) -> None:
    """历史 bug 残留形态：块内两条状态行取最后一条（design §5.2）。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "## ql-20260701-001-cccc | 2026-07-01 08:00:00 | 重复状态行样本\n"
        "状态：进行中\n"
        "状态：已完成（重跑 --done 翻状态）\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260701-001-cccc")
    assert e.status == "completed"
    assert e.status_note == "重跑 --done 翻状态"


def test_halfwidth_colon_labels(tmp_path: Path) -> None:
    """全半角冒号混用（实测 WhaleFall 文件 ``方案:`` 形态）。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-WhaleFall-2026-06-24.md",
        "## ql-20260624-003-dddd | 2026-06-24 11:00:00 | 半角冒号样本\n"
        "状态:已完成\n"
        "方案: 半角冒号加空格。\n"
        "结果:两个都认。\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260624-003-dddd")
    assert e.status == "completed"
    assert e.body_sections["方案"] == "半角冒号加空格。"
    assert e.body_sections["结果"] == "两个都认。"


def test_file_bullet_fullwidth_note_with_nested_parens(tmp_path: Path) -> None:
    """多行 bullet 文件清单：全角括注内嵌半角括号（真实样本 ql-20260812-008）。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "## ql-20260812-008-c860 | 2026-08-12 21:36:52 | 测试质量审查修 P0 项\n"
        "状态：已完成\n"
        "文件：\n"
        "- backend/app/modules/worktree/tests/test_router.py（补7个安全分支测试(revoked/expired 503、cross-user extend 403)）\n"
        "- backend/app/modules/worktree/service.py（修 tz 不健壮(SQLite naive vs aware)）\n"
        "结果：全绿。\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260812-008-c860")
    assert e.files[0].path == "backend/app/modules/worktree/tests/test_router.py"
    assert e.files[0].note == "补7个安全分支测试(revoked/expired 503、cross-user extend 403)"
    assert e.files[1].path == "backend/app/modules/worktree/service.py"
    assert e.files[1].note == "修 tz 不健壮(SQLite naive vs aware)"


def test_file_bullet_halfwidth_note_and_dashboard_trap(tmp_path: Path) -> None:
    """半角括注须前置空白：``src/app/(dashboard)/x.tsx (userId → res)`` 行尾括注提取，
    路径中段 ``(dashboard)`` 不被误判。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi-2026-06-23.md",
        "## ql-20260623-010-eeee | 2026-06-23 15:00:00 | 工时页 userId 修复\n"
        "状态：已完成\n"
        "文件：\n"
        "- frontend/src/app/(dashboard)/ppm/work-hours/page.tsx (userId → res=user)\n"
        "结果：绿。\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260623-010-eeee")
    assert e.files[0].path == "frontend/src/app/(dashboard)/ppm/work-hours/page.tsx"
    assert e.files[0].note == "userId → res=user"


def test_single_line_separators_plus_and_semicolon(tmp_path: Path) -> None:
    """单行分隔符 5 形态：``,``/``，``/``、``/``+``/``;``（真实样本混合）。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "## ql-20260701-002-ffff | 2026-07-01 09:00:00 | ppm 任务模块\n"
        "状态：已完成\n"
        "文件：后端 task/schema.py+service.py+router.py；前端 types.ts、task.ts\n"
        "结果：绿。\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260701-002-ffff")
    paths = [f.path for f in e.files]
    assert paths == [
        "后端 task/schema.py",
        "service.py",
        "router.py",
        "前端 types.ts",
        "task.ts",
    ]


def test_linked_changes_whitelist(tmp_path: Path) -> None:
    """白名单正则：日期前缀进列表；自由文本（backend-monitoring / quick-fix-* / （无））滤掉。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "## ql-20260804-001-gggg | 2026-08-04 10:00:00 | agent profile UI\n"
        "状态：已完成\n"
        "关联变更：2026-08-04-agent-profile-ui-redesign\n"
        "## ql-20260701-003-hhhh | 2026-07-01 10:00:00 | 监控修复\n"
        "状态：已完成\n"
        "关联变更：backend-monitoring\n"
        "## ql-20260722-001-iiii | 2026-07-22 09:00:48 | 运行时测试\n"
        "状态：已完成\n"
        "关联变更：quick-fix-task09-runtime-test\n"
        "## ql-20260809-001-jjjj | 2026-08-09 10:00:00 | 双条关联\n"
        "状态：已完成\n"
        "关联变更：2026-08-09-complete-stage-deepcopy、2026-08-09-stages-deepcopy-sweep\n",
    )
    entries = parse_quicklog_directory(ql)
    assert _entry(entries, "ql-20260804-001-gggg").linked_changes == [
        "2026-08-04-agent-profile-ui-redesign"
    ]
    assert _entry(entries, "ql-20260701-003-hhhh").linked_changes == []
    assert _entry(entries, "ql-20260722-001-iiii").linked_changes == []
    assert _entry(entries, "ql-20260809-001-jjjj").linked_changes == [
        "2026-08-09-complete-stage-deepcopy",
        "2026-08-09-stages-deepcopy-sweep",
    ]


def test_rotation_files_and_aggregate_coexist(tmp_path: Path) -> None:
    """聚合 + 日切文件条目独立并存（实测零重叠，全目录扫描）。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "## ql-20260812-007-d086 | 2026-08-12 20:43:59 | 聚合文件条目\n状态：已完成\n",
    )
    _write(
        ql / "QUICKLOG-qinyi-2026-08-12.md",
        "## ql-20260812-005-abcd | 2026-08-12 18:00:00 | 日切文件条目\n状态：已完成\n",
    )
    entries = parse_quicklog_directory(ql)
    assert {e.ql_id for e in entries} == {"ql-20260812-007-d086", "ql-20260812-005-abcd"}
    assert all(e.author_raw == "qinyi" for e in entries)


def test_unknown_lines_go_to_free_section(tmp_path: Path) -> None:
    """未知行归自由段（宽松解析不丢数据）；正文标签后接续行归该段。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "## ql-20260801-001-kkkk | 2026-08-01 09:00:00 | 自由文本形态\n"
        "状态：已完成\n"
        "补充说明：这不是已知标签，应进自由段。\n"
        "需求：第一行需求。\n"
        "第二行是需求的接续。\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260801-001-kkkk")
    assert "补充说明：这不是已知标签，应进自由段。" in e.body_sections["_free"]
    assert e.body_sections["需求"] == "第一行需求。\n第二行是需求的接续。"


def test_missing_status_defaults_in_progress(tmp_path: Path) -> None:
    """缺状态行的块保守视为进行中（查询层可据时间派生 stale）。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "## ql-20260810-001-llll | 2026-08-10 09:00:00 | 无状态行\n需求：骨架条目。\n",
    )
    e = _entry(parse_quicklog_directory(ql), "ql-20260810-001-llll")
    assert e.status == "in_progress"
    assert e.status_note is None


def test_malformed_header_ignored(tmp_path: Path) -> None:
    """非条目 ``##`` 标题（目录级 heading）不切块。"""
    ql = tmp_path / "quicklog"
    ql.mkdir()
    _write(
        ql / "QUICKLOG-qinyi.md",
        "# QUICKLOG\n"
        "## 说明\n"
        "这是说明文字，不是条目。\n"
        "## ql-20260801-002-mmmm | 2026-08-01 10:00:00 | 真条目\n"
        "状态：已完成\n",
    )
    entries = parse_quicklog_directory(ql)
    assert [e.ql_id for e in entries] == ["ql-20260801-002-mmmm"]


def test_cache_fingerprint_invalidation(tmp_path: Path) -> None:
    """(name, mtime) 指纹缓存：未变更命中（内容改回写同值不破）；mtime 变更重解析。"""
    import app.modules.change.quicklog_parser as qp

    qp._QUICKLOG_CACHE.clear()
    ql = tmp_path / "quicklog"
    ql.mkdir()
    f = ql / "QUICKLOG-qinyi.md"
    _write(f, "## ql-20260801-003-nnnn | 2026-08-01 11:00:00 | v1\n状态：进行中\n")
    first = parse_quicklog_directory(ql)
    assert first[0].title == "v1"

    # 命中缓存：返回的是 deepcopy（条目 frozen 不可变，验证列表层独立——
    # 调用方对返回列表的改动不污染缓存）
    again = parse_quicklog_directory(ql)
    assert again[0].title == "v1"
    assert again is not parse_quicklog_directory(ql)

    # mtime 变更（显式设置不同 mtime 保证指纹变化，避开同秒粒度）
    import os

    _write(
        f,
        "## ql-20260801-003-nnnn | 2026-08-01 11:00:00 | v2\n状态：已完成\n",
    )
    st = f.stat()
    os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
    third = parse_quicklog_directory(ql)
    assert third[0].title == "v2"
    assert third[0].status == "completed"
