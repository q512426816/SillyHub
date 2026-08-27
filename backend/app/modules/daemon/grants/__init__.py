"""Daemon runtime grants submodule — 统一授权表（D-006@v1）。

Change 2026-08-28-daemon-agent-share task-01：``daemon_runtime_grants`` 表
（:class:`DaemonRuntimeGrant`）承载工作区共享与平台共享智能体两种授权，
是迁移后唯一的授权判定数据源（原 ``workspace_member_runtimes.shared`` 列
保留为 UI 缓存，不再参与鉴权查询）。
"""

from app.modules.daemon.grants.model import DaemonRuntimeGrant

__all__ = ["DaemonRuntimeGrant"]
