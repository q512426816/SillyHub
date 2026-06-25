---
author: qinyi
created_at: 2026-06-25T15:50:00
---

# 实现计划：interactive-idle-timeout-fix

> plan_level: medium。双修方案（D-001@v1 移除 idle + D-002@v1 完成驱动 end），2 Wave 5 任务。
> 设计依据：`design.md` / `requirements.md`（FR-1~FR-7）/ `decisions.md`（D-001@v1 / D-002@v1 / D-003@v1）
> FR-7（手动终止链路不变）无改动任务——本变更不碰前端 endSession / backend end_session HTTP 端点 / FR-05 协议，FR-7 作为回归验证项在 verify 阶段确认，不计独立 task。

## Wave 1：核心修复（daemon + backend 两端，可并行）

- [ ] task-01: daemon idle 自动回收默认禁用
- [ ] task-02: backend facade 完成驱动 end 委托方法
- [ ] task-03: complete_lease 完成驱动 end 钩子

### task-01: task-daemon-idle-disable
- **文件**：`sillyhub-daemon/src/interactive/session-manager.ts`
- **覆盖**：FR-1, FR-2, D-001@v1
- **改动点**：
  - `DEFAULT_IDLE_TIMEOUT_SEC`（182）：`1800` → `0`
  - `startIdleMonitor()`（1188）：增守卫 `if (this._idleTimeoutSec <= 0) return;`
  - env `SESSION_IDLE_TIMEOUT_SEC` 解析（259-265）保留：`>0` 启用、`0/负/非法` 禁用
  - `_scanIdle()`（1239）/`_onIdleExpire()`（1268）逻辑保留，定时器不启动则永不触发
- **完成标准**：idle 定时器默认不启动；env>0 可恢复旧行为

### task-02: task-backend-facade-end（在 task-03 前定义委托方法）
- **文件**：`backend/app/modules/daemon/session/service.py`（end 落地）+ `backend/app/modules/daemon/lease/service.py`（facade 反向委托入口）
- **覆盖**：FR-3, FR-4, D-002@v1
- **改动点**：
  - session 子域增 `_end_session_for_completed_lease(agent_session_id, reason)` 方法，复用现有 `ws_hub.send_session_control(session_end)` FR-05 链路（`session/service.py:765`）
  - lease 子域经 `self._facade._end_session_for_completed_lease(...)` 调用（D-006 反向委托模式，对齐 `_run_post_scan_validation`）
- **完成标准**：facade 委托方法可被 lease 子域调用，内部走 FR-05 链路

### task-03: task-backend-complete-lease-end
- **文件**：`backend/app/modules/daemon/lease/service.py`（`complete_lease`，278）
- **覆盖**：FR-3, FR-4, FR-5, FR-6, D-002@v1
- **改动点**：
  - `complete_lease` 收尾链末尾（post_scan 校验之后，`daemon_lease_completed` 日志之前）增完成驱动 end 钩子
  - 判定：`agent_run.change_id is not None`（stage）或 `spec_strategy == "platform-managed"`（scan）→ should_end
  - 取 `agent_run.agent_session_id`（model.py:195 字段，非 lease metadata）
  - should_end + agent_session_id 存在 → 调 `self._facade._end_session_for_completed_lease(...)`
  - try/except + warn log（`complete_lease_end_session_failed`），不阻塞 lease 完成
- **完成标准**：scan/stage lease 完成 → end_session 调用；多轮对话不调；失败不阻塞

## Wave 2：测试 + 文档（依赖 Wave 1 实现）

- [ ] task-04: daemon idle 禁用单测
- [ ] task-05: complete_lease 完成驱动 end 单测
- [ ] task-06: 模块文档契约更新

### task-04: task-daemon-idle-test
- **文件**：`sillyhub-daemon/src/interactive/__tests__/session-manager-idle-disabled.test.ts`（新增）
- **覆盖**：FR-1, FR-2, SC-2, SC-4
- **用例**：
  1. 默认配置（不传 idleTimeoutSec、无 env）→ `_idleTimer` 为 null（不启动）
  2. 长 turn（持续 tool_use 事件）30min 后 → 不触发 end
  3. env `SESSION_IDLE_TIMEOUT_SEC=1800` → `_idleTimer` 启动（旧行为恢复）
- **完成标准**：3 用例通过

### task-05: task-backend-lease-test
- **文件**：`backend/app/modules/daemon/tests/test_lease_service.py`
- **覆盖**：FR-3, FR-4, FR-5, FR-6, SC-1, SC-5, SC-6
- **用例**：
  1. scan lease 完成（change_id=None + platform-managed + agent_session_id）→ 断言 end_session 被调用
  2. stage lease 完成（change_id 非空）→ 断言 end_session 被调用
  3. 多轮对话 lease 完成（非 platform-managed）→ 断言 end_session 未调用
  4. end_session 抛异常 → lease 仍 completed（容错）
  5. agent_session_id 为空 → 跳过 end，lease 仍 completed
- **完成标准**：5 用例通过，mock facade 验证调用

### task-06: task-doc-sync
- **文件**：`.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md`
- **覆盖**：D-001@v1, D-002@v1
- **改动点**：
  - idle 回收默认禁用（env 逃生口）契约更新
  - 完成驱动 end 契约（scan/stage 完成主动 end_session）补充
- **完成标准**：模块文档与实现一致

## 依赖关系

```
Wave1:  task-01 (daemon-idle-disable) ─┐
        task-02 (facade-end) ──────────→ task-03 (complete-lease-end)
Wave2:  task-04 (daemon-idle-test) ←── task-01
        task-05 (backend-lease-test) ←── task-03
        task-06 (doc-sync) ←── (Wave1 两端实现定稿)
```

- Wave1 内：task-02 须先于 task-03（定义委托方法 → 引用）
- Wave1 两端（daemon / backend）完全独立可并行
- Wave2 全部依赖 Wave1 实现
- FR-7（手动终止链路不变）无 task，verify 阶段回归验证
- 无 schema / migration 变更 → 无迁移链断裂风险
