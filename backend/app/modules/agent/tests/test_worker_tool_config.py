"""Tests for worker_tool_config 白名单（agent-file-upload-mcp task-04）。

设计依据：2026-08-23-agent-file-upload-mcp design §10 R-02 + §6
execution.py 行 + D-008@v1（FR-02）——worker（claude 引擎）的显式
allowed_tools 白名单会物理禁掉未列名的工具，须追加整服务器名
``mcp__sillyhub-file``（不用 ``mcp__sillyhub-file__*`` 通配写法，
claude CLI 通配行为未验证）放行 upload_file / list_uploaded_files。

worker_tool_config 是纯函数，无需 DB session，直接断言返回 dict。
"""

from __future__ import annotations

from app.modules.agent.execution import worker_tool_config

# 整服务器名（非通配）——R-02 明确不用 mcp__sillyhub-file__* 写法
_FILE_MCP_SERVER = "mcp__sillyhub-file"


class TestWorkerToolConfigFileMcpWhitelist:
    """task-04：两分支白名单放行 mcp__sillyhub-file，只读治理不回归。"""

    def test_read_only_whitelist_contains_file_mcp_server(self) -> None:
        """read_only 分支 allowed_tools 含整服务器名 mcp__sillyhub-file（FR-02）。"""
        cfg = worker_tool_config(True)
        assert _FILE_MCP_SERVER in cfg["allowed_tools"]

    def test_write_whitelist_contains_file_mcp_server(self) -> None:
        """write 分支 allowed_tools 同样含整服务器名 mcp__sillyhub-file。"""
        cfg = worker_tool_config(False)
        assert _FILE_MCP_SERVER in cfg["allowed_tools"]

    def test_read_only_still_excludes_write_tools(self) -> None:
        """既有只读治理不回归：read_only 分支仍不含 Edit/Write/Bash。"""
        cfg = worker_tool_config(True)
        for tool in ("Edit", "Write", "Bash"):
            assert tool not in cfg["allowed_tools"], f"read_only 不应放行 {tool}"

    def test_read_only_baseline_tools_unchanged(self) -> None:
        """read_only 分支其余键值不变：mode=plan、max_turns=25、只读三工具仍在。"""
        cfg = worker_tool_config(True)
        assert cfg["mode"] == "plan"
        assert cfg["max_turns"] == 25
        for tool in ("Read", "Glob", "Grep"):
            assert tool in cfg["allowed_tools"]
        # 纯追加语义：除新增服务器名外白名单不多不少
        assert set(cfg["allowed_tools"]) == {"Read", "Glob", "Grep", _FILE_MCP_SERVER}

    def test_write_baseline_tools_unchanged(self) -> None:
        """write 分支其余键值不变：mode=acceptEdits、max_turns=30、六工具仍在。"""
        cfg = worker_tool_config(False)
        assert cfg["mode"] == "acceptEdits"
        assert cfg["max_turns"] == 30
        for tool in ("Read", "Glob", "Grep", "Edit", "Write", "Bash"):
            assert tool in cfg["allowed_tools"]
        assert set(cfg["allowed_tools"]) == {
            "Read",
            "Glob",
            "Grep",
            "Edit",
            "Write",
            "Bash",
            _FILE_MCP_SERVER,
        }

    def test_whitelist_uses_exact_server_name_not_wildcard(self) -> None:
        """用整服务器名而非通配写法：白名单内不得出现通配条目（design §6/R-02）。"""
        for read_only in (True, False):
            cfg = worker_tool_config(read_only)
            assert not any(str(t).endswith("*") for t in cfg["allowed_tools"]), (
                "不得使用 mcp__sillyhub-file__* 通配写法"
            )
