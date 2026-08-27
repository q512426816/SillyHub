"""Tests for worker_tool_config 白名单（agent-file-upload-mcp task-04）。

设计依据：2026-08-23-agent-file-upload-mcp design §10 R-02 + §6
execution.py 行 + D-008@v1（FR-02）——worker（claude 引擎）的显式
allowed_tools 白名单会物理禁掉未列名的工具，须追加整服务器名
``mcp__sillyhub-file``（不用 ``mcp__sillyhub-file__*`` 通配写法，
claude CLI 通配行为未验证）放行 upload_file / list_uploaded_files。

worker_tool_config 是纯函数，无需 DB session，直接断言返回 dict。
"""

from __future__ import annotations

from app.modules.agent.execution import (
    platform_shared_tool_config,
    worker_tool_config,
)

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
        # 纯追加语义（P0 修复后）：白名单不多不少（含两个 MCP 服务器名）
        assert set(cfg["allowed_tools"]) == {
            "Read",
            "Glob",
            "Grep",
            _FILE_MCP_SERVER,
            _WORKER_MCP_SERVER,
        }

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
            _WORKER_MCP_SERVER,
        }

    def test_whitelist_uses_exact_server_name_not_wildcard(self) -> None:
        """用整服务器名而非通配写法：白名单内不得出现通配条目（design §6/R-02）。"""
        for read_only in (True, False):
            cfg = worker_tool_config(read_only)
            assert not any(str(t).endswith("*") for t in cfg["allowed_tools"]), (
                "不得使用 mcp__sillyhub-file__* 通配写法"
            )


# ── P0 修复（2026-08-26）：worker_done 通道放行 ──

_WORKER_MCP_SERVER = "mcp__sillyhub-worker"


class TestWorkerMcpServerAllowed:
    """P0（阿里云会话 6603bec3 实证）：两分支白名单必须含整服务器名
    ``mcp__sillyhub-worker``——daemon 受限 server 注入的 worker_done 等
    工具全名带该前缀，白名单缺失会被 --allowedTools 物理拒绝，
    worker 永远无法上报完成（mission 死锁 running）。"""

    def test_read_only_branch_allows_worker_server(self):
        cfg = worker_tool_config(read_only=True)
        assert _WORKER_MCP_SERVER in cfg["allowed_tools"]

    def test_write_branch_allows_worker_server(self):
        cfg = worker_tool_config(read_only=False)
        assert _WORKER_MCP_SERVER in cfg["allowed_tools"]

    def test_file_server_still_allowed(self):
        for ro in (True, False):
            assert _FILE_MCP_SERVER in worker_tool_config(read_only=ro)["allowed_tools"]


# ── task-05（2026-08-28-daemon-agent-share / FR-04 / D-009@v1）：平台共享
#    会话工具集构造 platform_shared_tool_config 枚举断言 ──


class TestPlatformSharedToolConfig:
    """平台共享智能体会话：mode=acceptEdits + 显式白名单（无 Bash/NotebookEdit）。

    D-009@v1：daemon 写守卫对 Bash 写目标靠正则提取（python -c/node -e 等
    提取为空 → 放行逃逸），平台共享会话整体不给 Bash，产出走 Write/Edit；
    NotebookEdit 同为可落盘逃逸面，一并排除。两个整服务器名 MCP 对齐
    worker_tool_config 先例（显式白名单物理禁掉未列名工具）。
    """

    def test_mode_is_accept_edits(self) -> None:
        """产出走 Edit/Write：mode=acceptEdits（D-002@v2 指定目录可写语义）。"""
        cfg = platform_shared_tool_config()
        assert cfg["mode"] == "acceptEdits"

    def test_allowed_tools_exact_set(self) -> None:
        """白名单不多不少：读写基础三件 + Edit/Write + 两个整服务器名 MCP。"""
        cfg = platform_shared_tool_config()
        assert set(cfg["allowed_tools"]) == {
            "Read",
            "Glob",
            "Grep",
            "Edit",
            "Write",
            _FILE_MCP_SERVER,
            _WORKER_MCP_SERVER,
        }

    def test_excludes_bash_and_notebook_edit(self) -> None:
        """D-009 红线：不含 Bash（shell 写逃逸面）/ NotebookEdit（落盘逃逸面）。"""
        cfg = platform_shared_tool_config()
        for tool in ("Bash", "NotebookEdit"):
            assert tool not in cfg["allowed_tools"], f"平台共享会话不应放行 {tool}"

    def test_no_wildcard_entries(self) -> None:
        """对齐 R-02：不用 mcp__server__* 通配写法（CLI 通配行为未验证）。"""
        cfg = platform_shared_tool_config()
        assert not any(str(t).endswith("*") for t in cfg["allowed_tools"])

    def test_no_max_turns_bound(self) -> None:
        """交互式会话按轮次驱动，不设 worker 式 max_turns 执行上界。"""
        cfg = platform_shared_tool_config()
        assert "max_turns" not in cfg
