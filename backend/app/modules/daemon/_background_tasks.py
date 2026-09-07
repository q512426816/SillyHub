"""后台任务生命周期共享 mixin（task-11 轻重构③，design §5 Wave 2）。

``_fire_background_task`` 在 SessionService 与 RunSyncService 曾逐字节相同
（原 session/service.py:978 / run_sync/service.py:595），``_on_background_
task_done`` 仅类名引用差异（``SessionService._background_tasks`` vs
``RunSyncService._background_tasks``）——两份实现收敛为本模块。

结构（与既有「类壳一行委托」拆分范式同构）：

- ``BackgroundTaskMixin._fire_background_task``：完整实现挂在 mixin，两个
  宿主 Service 继承后原方法删除（MRO 解析语义不变：patch.object(宿主类,
  "_fire_background_task", ...) 经类字典遮蔽 mixin 照常拦截）；
- ``on_background_task_done(host_cls, task)``：done 回调共享核心。**宿主类
  各保留一个两行 staticmethod 壳**（``_on_background_task_done``）传入自身
  类——staticmethod 表面是既有行为契约：test_run_sync_fire_background_task
  以 ``inspect.getattr_static(RunSyncService, "_on_background_task_done")``
  断言 staticmethod 且签名为 ``(task)``（与 agent/service.py 同名 helper 对
  齐）。staticmethod 无法经 self/cls 多态定位宿主，类引用是仅存的每宿主差异
  （正是收敛前两份实现的全部差异），故保留在壳内。

不变量：

- 每个宿主类持**自己的**类级 ``_background_tasks`` set（mixin 只声明注解不
  提供共享默认值）——两个 Service 的集合互不串扰，既有测试
  ``<Host>._background_tasks.clear()`` 语义不变；
- 日志经宿主模块命名空间延迟解析（``sys.modules[cls.__module__].log``，
  D-007 同规则）：``patch.object(run_sync.service.log, "info"/"exception")``
  与 ``patch("...service.log")`` 两类 patch 面都照常拦截，模块级 logger
  身份（事件名 ``background_task_fired`` / ``background_task_failed``）不变。
"""

from __future__ import annotations

import asyncio
import sys
import uuid


def _host_log(cls: type) -> object:
    """经宿主类所在模块命名空间取 ``log``（调用时延迟解析，patch 面不变）。"""
    return sys.modules[cls.__module__].log


def fire_background_task(
    host: object,
    coro: object,
    *,
    workspace_id: uuid.UUID | None = None,
    run_id: uuid.UUID | None = None,
) -> asyncio.Task:
    """Create a background task and hold a strong reference to prevent GC.

    ``host`` 为宿主 service 实例——强引用集经 ``host._background_tasks``
    多态解析，日志经宿主类模块的 ``log`` 记录。
    """
    task = asyncio.create_task(coro)
    host._background_tasks.add(task)
    task.add_done_callback(host._on_background_task_done)
    _host_log(type(host)).info(
        "background_task_fired",
        task_id=id(task),
        workspace_id=str(workspace_id),
        run_id=str(run_id),
    )
    return task


def on_background_task_done(host_cls: type, task: asyncio.Task) -> None:
    """Remove task from the tracking set and surface exceptions.

    ``host_cls`` 为宿主 Service 类（由各宿主 staticmethod 壳传入）——discard
    落在该类自己的 ``_background_tasks`` 集，与收敛前硬编码类名等价。
    """
    host_cls._background_tasks.discard(task)
    try:
        exc = task.exception()
    except (asyncio.InvalidStateError, asyncio.CancelledError):
        return
    if exc is not None:
        _host_log(host_cls).exception(
            "background_task_failed",
            task_id=id(task),
            exc_info=exc,
        )


class BackgroundTaskMixin:
    """后台任务生命周期 mixin——``_fire_background_task`` 单源实现。

    宿主约定：①类级 ``_background_tasks: set[asyncio.Task] = set()``（各自
    持有，勿继承共享默认）；②模块级 ``log``；③两行 staticmethod 壳
    ``_on_background_task_done``（委托 :func:`on_background_task_done`，保
    staticmethod 表面）。gate enqueue（H4）、恢复钩子派发（D-008）等调用点
    经 ``svc._fire_background_task(...)`` 零变化。
    """

    # 注解仅声明契约；实际集合由各宿主类自带（防跨宿主共享同一 set）。
    _background_tasks: set[asyncio.Task]

    def _fire_background_task(
        self,
        coro,
        *,
        workspace_id: uuid.UUID | None = None,
        run_id: uuid.UUID | None = None,
    ) -> asyncio.Task:
        """Create a background task and hold a strong reference to prevent GC."""
        return fire_background_task(self, coro, workspace_id=workspace_id, run_id=run_id)
