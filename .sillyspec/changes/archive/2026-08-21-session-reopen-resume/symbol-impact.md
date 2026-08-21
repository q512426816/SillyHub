---
author: qinyi
created_at: 2026-08-21 12:16:15
---

# 符号影响面扫描报告（execute 加载上下文步产物）

> 扫描范围：tasks/task-01 ~ task-09 的 allowed_paths；变更类型覆盖签名/构造参数/DTO 字段/返回类型/全局符号。逐 task 结论如下。

## 逐任务结论

| task | 涉及签名级变更 | 结论与影响面 |
|---|---|---|
| task-01 | 无 | submit_messages 内部逻辑增量（latest_session_id 块旁加回填），函数签名/返回类型不变；无既有调用方受影响 |
| task-02 | 无 | 纯新增（迁移文件 + 独立测试），不触碰既有符号 |
| task-03 | **有（3 处，全部向后兼容）** | ① `SessionRuntimeRequest`（Pydantic DTO）加可选字段 `lease_id: uuid.UUID \| None = None`——消费方仅 router.py:1296/:1318 两端点（FastAPI body 解析，旧 daemon 不传即 None 兼容）；② `confirm_session_reconnected` / `mark_session_recovery_failed`（session/service.py:2060/:2130）加可选 keyword 参 `lease_id=None`——全部调用方已核实共 4 处：router.py:1311/:1334（本 task 同步透传）、daemon/service.py:739/:748 包装方法（本 task 同步加透传形参，亦可默认不传——实现时二选一，默认 None 兼容）；③ 返回 Literal 若放宽取值，`SessionRecoveryResponse.status` 本为 str 不受影响。另新增模块级常量 `RECONNECTING_RETRY_WINDOW_SEC=180`（新符号，无冲突） |
| task-04 | 无（新增符号 1 个） | reopen_session 内部校验分支扩展，签名不变；新增异常类 `DaemonSessionNoCwd`（AppError 子类，按 session/service.py:181-213 异常区惯例，code/http_status 自带，全局 handler 已覆盖 AppError 家族无需额外注册） |
| task-05 | 无 | 纯新增符号（sweep.py 两函数）+ main.py lifespan 装配段（模块级，无既有函数签名变化） |
| task-06 | **有（TS 侧 3 处，全部结构兼容）** | ① `HubClient.confirmReconnected`（hub-client.ts:809）签名加可选参 `opts?: { leaseId?; runtimeId? }`——既有调用方 daemon.ts:1331（recover 链路，不传 opts 兼容）；② `HubClient.markRecoveryFailed`（:824）同样加 opts——既有调用方 daemon.ts:1369/:1389 + :1364-1375 桥接（均不传兼容）；③ `daemon.ts ClientLike` 接口（:265）加两个可选方法声明（`?` 可选有 :283 markOffline? 先例，既有测试 mock 不破坏）。`RecoveryCoordinator` 接口（:516/:518）不动 |
| task-07 | 无 | 仅测试文件新增/扩展 mock 与断言 |
| task-08 | 无（类型再生成） | page.tsx 组件内部（复用 handleReopen 不改签名）；api-types.ts 由 gen:types 再生成（SessionRuntimeRequest 类型加可选字段，前端消费为零——前端不直接调这两端点，daemon 才调） |
| task-09 | 无 | 文档与说明文件 |

## 跨任务符号冲突检查

- `RECONNECTING_RETRY_WINDOW_SEC` 唯一定义 task-03（session/service.py），task-04/05 仅 import——无重复定义。
- `DaemonSessionNoCwd` 仅 task-04 定义；task-08 前端映射表引用其错误码字符串（HTTP_409_DAEMON_SESSION_NO_CWD），非符号依赖。
- session/service.py 被 task-03（confirm/mark-failed/常量）与 task-04（reopen 校验/新异常）分层修改，**无重叠函数**——异 Wave 串行执行安全。
- backend 请求体与 daemon TS 侧 lease_id 命名对齐（snake_case HTTP ↔ camelCase opts.leaseId，hub-client 序列化处转换，task-06 实现点）。

## 结论

签名级变更共 2 个任务（task-03 Python 侧、task-06 TS 侧），全部为**加可选参数/字段**的向后兼容扩展，既有调用方已逐一核实并纳入对应任务同步透传或默认兼容；无破坏性变更，无跨任务符号冲突。
