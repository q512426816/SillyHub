---
id: task-02
title: _execute_scan_run 成功收尾自动 reparse 子组件
priority: P0
estimated_hours: 3
depends_on: []
blocks: [task-06]
allowed_paths:
  - backend/app/modules/agent/service.py
created_at: 2026-06-03 15:21:43
author: WhaleFall
---

# task-02 _execute_scan_run 成功收尾自动 reparse 子组件

## 背景

依据 `design.md` 决策 4：scan agent run 成功（`exit_code == 0`）后，应自动解析
`spec_root/projects/*.yaml` 创建子 workspace + relations，省去用户手动 reparse。
子组件创建属于「收尾增强」，一旦解析异常不得把已成功的 scan run 标记为 failed，
因此 reparse 调用必须包在独立 try/except，失败只记 `log.warning`。

`AgentService._execute_scan_run` 运行在 `asyncio.create_task` 拉起的后台任务里，
使用独立 DB session（`backend/app/modules/agent/service.py:1094` 的
`async with factory() as session`）。本任务在该后台 session 上构造
`WorkspaceService(session)` 并调用 `reparse(workspace_id)`。

## 修改文件（精确路径与方法）

- 文件：`backend/app/modules/agent/service.py`
- 方法：`AgentService._execute_scan_run`（定义于约 1072-1188 行）
- 修改点：成功收尾分支。当前成功/失败 run 记录更新发生在 1126-1165 行区间，
  收尾 `await session.commit()` 在 **1165 行**。reparse 收尾代码插入在
  **该 commit（1165 行）之后、`try` 块结束之前**（即 1167 行 `except` 之前）。

> 仅修改此文件此方法，不得新建文件、不得改动其他模块。

## 实现要求（具体步骤）

1. 保持现有 1126-1165 行成功/失败 run 记录更新与 `await session.commit()` 不动。
   该 commit 先把 run 的 `completed/failed` 状态、日志、审计落库——这是「run 成功」
   的事实来源，必须先于 reparse 落库，确保即使 reparse 阶段崩溃 run 仍是 completed。
2. 在 `await session.commit()`（1165 行）**之后**新增收尾逻辑：
   - 判断 `result.exit_code == 0`（仅成功才 reparse；非 0 直接跳过）。
   - 仅在成功分支内，用同一后台 `session` 实例化
     `WorkspaceService(session)`（构造签名见「接口定义」）。
   - `await svc.reparse(workspace_id)` 创建子 workspace + relations。
3. 整个 reparse 调用（含 `WorkspaceService` 构造与 `await reparse`）**必须**包在
   独立 `try/except Exception as exc` 内：
   - 成功：记 `log.info("scan_run_reparse_done", run_id=..., workspace_id=..., stats=...)`（可选）。
   - 失败：仅记 `log.warning("scan_run_reparse_failed", run_id=str(run_id),
     workspace_id=str(workspace_id), error=str(exc))`；**不 re-raise、不改 run.status、
     不改 exit_code**。
4. 该 reparse 的 try/except 不得吞掉外层 1167 行 `except`（即不要把 reparse 写进让
   外层 except 误判 run 失败的位置）。reparse 失败被内层 except 完全消化，外层不感知。
5. `WorkspaceService` 的 import 放在方法内局部 import（与现有
   `from app.core.db import get_session_factory` 等局部 import 风格一致），
   路径：`from app.modules.workspace.service import WorkspaceService`，避免顶层循环依赖。

## 接口定义（照此实现）

### WorkspaceService 构造

```python
# backend/app/modules/workspace/service.py:74
def __init__(self, session: AsyncSession, scanner: WorkspaceScanner | None = None) -> None
```
- 后台收尾仅需传 `session`：`WorkspaceService(session)`。

### reparse 签名与返回

```python
# backend/app/modules/workspace/service.py:372
async def reparse(
    self,
    workspace_id: uuid.UUID,
) -> tuple[ParseResult, dict[str, int], list[Workspace], list[WorkspaceRelation]]:
    ...
```
- 返回 4 元组：`(parse_result, stats, children, relations)`。
- `stats` 形如 `{"parsed", "created", "updated", "deleted", "relations_created",
  "relations_deleted"}`（见 `service.py:443-450`）。
- **关键事务事实**：`reparse` 内部**自带** `await self._session.commit()`
  （`service.py:568`）。因此 reparse 复用后台 session 时会在其内部提交，
  调用方**不需要**也**不应该**在 reparse 之后再 commit 一次子组件结果。
- 仅在 `workspace_id` 缺失/软删时抛 `WorkspaceNotFound`；
  `projects/*.yaml` 不存在时返回空 parse_result（不抛），`created` 为 0。

### 收尾调用伪代码（注意 commit 顺序）

```python
# ... 1126-1163: 更新 run 状态 / 日志 / 审计 (现有代码不动) ...
await session.commit()                      # (1165) 先落库 run completed —— 成功事实

# ---- 新增：成功收尾自动 reparse 子组件 ----
if result.exit_code == 0:
    try:
        from app.modules.workspace.service import WorkspaceService

        svc = WorkspaceService(session)
        # reparse 内部自带 commit，无需调用方再 commit
        _parse_result, stats, _children, _relations = await svc.reparse(workspace_id)
        log.info(
            "scan_run_reparse_done",
            run_id=str(run_id),
            workspace_id=str(workspace_id),
            created=stats.get("created"),
            relations_created=stats.get("relations_created"),
        )
    except Exception as exc:
        log.warning(
            "scan_run_reparse_failed",
            run_id=str(run_id),
            workspace_id=str(workspace_id),
            error=str(exc),
        )
        # 不改 run.status，不改 exit_code，不 re-raise

# (1167) 外层 except 保持不变
```

## 边界处理（至少 5 条）

1. **`exit_code != 0` 不 reparse**：失败/被 kill 的 scan run 不触发子组件创建，
   `if result.exit_code == 0` 守卫，非 0 直接跳过收尾。
2. **reparse 抛异常仅 warning 不连带 run failed**：reparse 内任意异常
   （解析错误、`WorkspaceNotFound`、DB 异常等）被内层 `except Exception` 捕获，
   只 `log.warning("scan_run_reparse_failed", ...)`；run 已在 1165 行 commit 为
   completed，不回改、不抛出，外层 1167 行 except 不感知。
3. **`projects/*.yaml` 不存在时 reparse 返回空**：reparse 调 parser 解析空目录返回
   空 `parse_result`，`stats["created"] == 0`，正常 commit，不报错——收尾视为成功无子组件。
4. **session 事务边界**：reparse 复用后台 session 且内部自带 commit
   （`service.py:568`）。run 状态在 1165 行先独立 commit 落库；reparse 的子组件 +
   relations 在 reparse 内部第二次 commit。两次 commit 解耦，reparse 失败时其内部
   未提交的子组件变更随异常回滚/丢弃，但已 commit 的 run completed 不受影响。
   收尾代码不得在 reparse 之后再补 commit（避免对已被 reparse 提交/回滚的 session 二次操作）。
5. **不重复创建已存在子 workspace**：由 reparse 内部 UPSERT 保证
   （`service.py:462-507`，按 `source_yaml_path` / `component_key` 匹配 existing，
   命中则 UPDATE，未命中才 CREATE）。重复 scan 收尾不会产生重复子 workspace。
6. **run 记录缺失 / adapter 缺失的早退分支不触发**：1098-1100、1104-1111 的早 `return`
   分支在到达收尾前已退出，天然不进入 reparse。
7. **后台 session 已关闭风险**：收尾在 `async with factory() as session` 块内、
   外层 except 之前执行，session 仍开启可用，reparse 在其上构造 `WorkspaceService` 安全。

## 非目标

- 不修改 `WorkspaceService.reparse` 内部逻辑（解析、UPSERT、relations、commit 全不动）。
- 不改动前端（弹窗 / 详情页由 task-03 / task-04 负责）。
- 不新增 / 修改任何 API 端点。
- 不修改 run 状态机、不动 1126-1165 现有 run 更新与审计逻辑。
- 不修改 `scan_generate`（task-01 范围）。

## 参考

- reparse 现有 UPSERT 模式：`backend/app/modules/workspace/service.py:442-507`
  （按 `source_yaml_path` / `component_key` 匹配 existing → UPDATE，否则 CREATE）。
- reparse 内部自带 commit：`backend/app/modules/workspace/service.py:568`。
- reparse 软删除被移除子组件：`service.py:511-518`；relations 重建：`service.py:521-565`。
- 后台独立 session 模式：`backend/app/modules/agent/service.py:1093-1094`。
- 局部 import 风格参考：`backend/app/modules/agent/service.py:1090-1091`。

## TDD 步骤

1. **先写测试（红）** 于 `backend/app/modules/agent/tests/`（task-06 落地，本任务可先放
   桩测试名）：
   - `test_scan_run_success_triggers_reparse`：mock adapter 返回 `exit_code == 0`，
     断言 `WorkspaceService.reparse` 被以 `workspace_id` 调用一次，且 run.status == "completed"。
   - `test_scan_run_failure_skips_reparse`：adapter 返回 `exit_code != 0`，断言
     reparse **未**被调用，run.status == "failed"。
   - `test_scan_run_reparse_exception_keeps_completed`：mock `reparse` 抛异常，断言
     run.status 仍为 "completed"、exit_code == 0，且记录了 `scan_run_reparse_failed`
     warning、未抛出。
2. **实现（绿）**：按「实现要求」在 1165 行 commit 后插入守卫 + try/except 收尾。
3. **重构**：确认局部 import、日志 key 命名与现有风格一致；确认未对 session 二次 commit。
4. **跑测试**：`pytest backend/app/modules/agent/tests/ -k scan_run` 全绿。

## 验收标准

| AC | 验收点 | 验证方式 | 期望 |
|---|---|---|---|
| AC-1 | 成功 scan 自动 reparse | mock adapter exit_code==0，断言 `reparse(workspace_id)` 被调用一次 | reparse 被调用，子组件按 stats 创建 |
| AC-2 | 失败 scan 不 reparse | mock adapter exit_code!=0，断言 reparse 未被调用 | reparse 调用次数为 0，run.status=="failed" |
| AC-3 | reparse 异常不连带 run 失败 | mock reparse 抛异常 | run.status=="completed"、exit_code==0、记 `scan_run_reparse_failed` warning、不抛出 |
| AC-4 | run 完成状态先落库 | 检查 1165 行 commit 在 reparse 之前；reparse 失败后 run 仍 completed | run completed 提交早于 reparse，互不连带 |
| AC-5 | 不重复创建子组件 | 对同一 workspace 连续两次成功收尾 | 第二次走 UPSERT 的 UPDATE 分支，子 workspace 数量不翻倍 |
| AC-6 | 变更范围受限 | git diff 仅触及 `backend/app/modules/agent/service.py` | 无其他文件改动，reparse 内部逻辑零修改 |
