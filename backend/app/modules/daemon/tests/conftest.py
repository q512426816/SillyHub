"""daemon 模块测试的 autouse 加速 fixture。

背景：session 集成测试（``create_session`` / ``inject_session`` / ``end_session``）
没有并发 daemon 上报 ready，``SessionReadiness.wait`` 在 ``session/service.py``
（create 611 / inject 790 硬编码 ``timeout=30``）实打实等满 30s（create+inject
串起来 60s）。全量 pytest 的 slowest 15 全集中在 daemon session 测试、合计
~570s，pytest-xdist 并行无效——sleep 型等待在 worker 内串行，墙钟被单个 worker
的串行 30/60s 拖到 12 分钟。``test_session_readiness.py`` 已用 ``fresh_readiness``
patch 规避（注释「避免源码硬编码 30s 真等」），但 5 个集成测试文件未同步。

本 fixture：对除 ``test_session_readiness`` 外的 daemon 测试，把 service / router
两模块的 ``get_session_readiness`` 替换为返回**每个测试新实例**，且 ``wait``
打桩成立即返回 True（正常路径免 30s 等待）；``mark_ready`` / ``clear`` 保留真实
行为（readiness set/event 语义不被破坏）。专测 readiness 超时兜底 / 单例语义的
``test_session_readiness`` 自己管理 patch，排除。
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.modules.daemon.session.service import SessionReadiness


@pytest.fixture(autouse=True)
def _fast_session_readiness(
    monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> None:
    """把 daemon session readiness 等待打桩成即时返回，消除 30/60s 干等。

    复刻 ``test_session_readiness.py::fresh_readiness`` 的隔离范式（每测试新实例），
    额外把 ``wait`` 打桩成立即 True。``test_session_readiness`` 自身要测 wait 真实
    语义（超时 / 并发唤醒 / 单例 / mark 后即返），不适用打桩，排除。
    """
    if request.module.__name__.endswith("test_session_readiness"):
        return

    import app.modules.daemon.router as router_mod
    import app.modules.daemon.session.service as svc_mod

    instance = SessionReadiness()
    # wait 立即返 True：正常路径 create/inject 不再真等 30s；mark_ready/clear 保留
    # 真实行为，readiness set/event 语义测试不受影响。
    instance.wait = AsyncMock(return_value=True)
    monkeypatch.setattr(svc_mod, "get_session_readiness", lambda: instance)
    monkeypatch.setattr(router_mod, "get_session_readiness", lambda: instance)
