"""knowledge 模块测试隔离占位。

distill 派发在 D-009/D-010 后已改为**同步执行**（resume 走 reopen+inject、
fresh 走 create_session，不再持有 fire-and-forget 后台任务集
``_BACKGROUND_DISTILL_TASKS``——该集合已随旧 bootstrap 派发链移除）。本文件
保留为隔离占位：后续若重新引入后台任务，按根 conftest
``_isolate_background_tasks`` 同款模式在此逐测试清理（防任务跨测试绑定已
关闭的 event loop）。
"""

from __future__ import annotations
