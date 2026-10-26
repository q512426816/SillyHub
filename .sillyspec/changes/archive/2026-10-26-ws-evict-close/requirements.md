---
author: flow-machine-draft
created_at: 2026-10-26T14:58:48.944Z
---
# 需求规格（Requirements）— 2026-10-26-ws-evict-close

## 功能需求

### FR-01: send 超时逐出与异常逐出路径均对旧 socket 主动 close（code=4000），daemon 侧可感知断线并重连

- 逐出路径（`_evict_stale` 在对象身份校验通过并从路由表移除之后）**必须**对被逐出的 WebSocket 主动调用 `close(code=4000, reason="evicted")`，使 daemon 侧立即收到关闭帧并触发其既有 close→退避重连路径；close 调用**必须**为 best-effort——socket 已死导致的任何异常须被吞掉，不得影响 `_evict_stale` 的逐出结果与 `send_to_runtime` 返回 False 的既有语义。

#### 场景：超时逐出触发主动关闭

Given 某 daemon 连接已注册且其 `send_json` 抛 `TimeoutError`，When `send_to_runtime` 执行完毕，Then 返回 False、路由表中该 daemon 被移除、且对该 ws 发生了 `close(code=4000)` 调用。

#### 场景：异常逐出触发主动关闭

Given 某 daemon 连接已注册且其 `send_json` 抛一般异常（如 `RuntimeError`），When `send_to_runtime` 执行完毕，Then 返回 False、路由表中该 daemon 被移除、且对该 ws 发生了 `close(code=4000)` 调用。

#### 场景：close 本身失败不反噬逐出

Given 被逐出 ws 的 `close` 方法抛异常，When 逐出路径执行完毕，Then 异常被吞掉（不向上传播）、逐出结果与既有语义完全一致。

### FR-02: 逐出 close 仅作用于被逐出的旧连接对象，不误伤并发重连的新连接（对象身份校验）

- `close` **禁止**在对象身份校验未通过时调用：当路由表中该 daemon_id 的连接已不是被逐出的那个 ws（已被并发重连的新连接替换）时，`_evict_stale` **必须**直接返回 False，**禁止**移除新连接、**禁止**对任何 WebSocket 调用 close；`close` 仅允许作用于身份校验通过且被移除的那个旧连接对象。

#### 场景：身份校验放过新连接

Given 路由表中某 daemon_id 的连接已被 new_ws 替换，When 以 old_ws 触发 `_evict_stale`，Then 返回 False、new_ws 保留在路由表且未被 close、old_ws 也未被 close。

### FR-03: 现有 ws_hub 相关测试全绿

- 本变更合入后，既有 ws_hub 测试面（连接管理、心跳、逐出、广播、生命周期、身份校验、会话控制、权限、策略）**必须**全部通过，行为回归为零。

#### 场景：主路径

Given 既有 ws_hub 四个测试文件，When 全量执行，Then 全部用例通过、无新增失败。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_ws_hub.py「TestSlowConnectionEviction::test_evicted_socket_gets_closed_on_timeout」「TestSlowConnectionEviction::test_evicted_socket_gets_closed_on_send_error」「TestSlowConnectionEviction::test_close_failure_does_not_break_eviction」
FR-02: backend/app/modules/daemon/tests/test_ws_hub.py「TestSlowConnectionEviction::test_evict_identity_check_spares_reconnected_new_socket」
FR-03: backend/app/modules/daemon/tests/test_ws_hub.py（全量）+ backend/app/modules/daemon/tests/test_ws_hub_session_control.py + backend/app/modules/daemon/tests/test_ws_hub_permission.py + backend/app/modules/daemon/tests/test_ws_hub_policy.py
