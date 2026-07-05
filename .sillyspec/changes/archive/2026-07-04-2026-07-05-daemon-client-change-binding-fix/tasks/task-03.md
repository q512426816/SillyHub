---
id: task-03
title: change/service.py write_file + _enqueue_edit_write 补 user_id + 现算 runtime
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P0
depends_on: [task-01]
blocks: [task-07]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/router.py
goal: "修 daemon-client 写变更文件抛 ChangeDocNotFound（write_file 链补 user_id + 现算 runtime）"
implementation: "write_file:328 加 user_id；router:216 传 user.id；_enqueue_edit_write:384 加 user_id；line 407 改调 resolve_runtime_for_writeback"
acceptance: "daemon-client 写变更文件成功落 DaemonChangeWrite（runtime_id 现算值）（AC-02）；user_id 调用链正确传递"
verify: "pytest change/tests/test_files_router.py（task-07 补新链路）"
constraints: "server-local 分支不变；_enqueue_edit_write 仅 daemon-client 触发"
---

# task-03 — change write_file + _enqueue_edit_write 补 user_id + 现算

## goal
修 daemon-client workspace 写变更文件抛 ChangeDocNotFound（D-001@v1 / FR-04 /
Grill 发现的 user_id 缺失）。

## 实现步骤
1. `change/service.py:328` `write_file` 签名加 `user_id: uuid.UUID`。
2. `change/router.py:216` write_file 端点传 `user.id`（端点依赖 `get_current_user`）。
3. `_enqueue_edit_write`（line 384）签名加 `user_id`；line 372 调用处传入。
4. line 407 `runtime_id = workspace.daemon_runtime_id` 改为：
   ```python
   runtime = await resolve_runtime_for_writeback(self._session, workspace.id, user_id)
   runtime_id = runtime.id
   ```

## 验收标准
- daemon-client workspace 写变更文件成功落 DaemonChangeWrite（runtime_id 现算值）（AC-02）。
- write_file 调用链 user_id 正确传递（router → service → _enqueue_edit_write）。

## 验证
- `pytest app/modules/change/tests/test_files_router.py`（task-07 补新链路）

## 约束
- server-local 分支不变（lease_id 非空走 worktree 直写）。
- `_enqueue_edit_write` 仅 daemon-client 分流触发（service.py:371 不动）。
