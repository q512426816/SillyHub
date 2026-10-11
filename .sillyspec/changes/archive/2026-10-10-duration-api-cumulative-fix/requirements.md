---
author: qinyi
created_at: 2026-10-10T20:55:00.000Z
---
# 需求规格（Requirements）— 2026-10-10-duration-api-cumulative-fix

## 功能需求

### FR-01: daemon duration_api_ms 按会话差分上报

daemon onTurnResult **必须**把 SDK 会话级累计快照 duration_api_ms 差分为本轮
增量再入 payload（快照 < 基线判复位报全量；基线随 onSessionEnd /
onSessionReloaded 回收）；duration_ms 语义不变照原样透传。

#### 场景：跨轮差分

- Given：同会话轮 1 快照 12000、轮 2 快照 25000
- When：各轮 onTurnResult
- Then：轮 1 payload 12000、轮 2 payload 13000

### FR-02: backend close 超界拒收

close_interactive_run **必须**拒收 duration_api_ms > duration_ms（墙钟）的写入
（保留既有值）；api ≤ 墙钟照常写入。

#### 场景：累计值拒收

- Given：close 入参 duration_ms=13246、duration_api_ms=3171192
- When：close_interactive_run
- Then：AgentRun.duration_api_ms 保持 NULL（不放大分母）

### FR-03: 相关测试通过（不跑全量）

daemon 差分三用例（差分/复位/回收）与 backend 守卫两用例（拒收/合法）**必须**
全绿；**禁止**运行全量测试套件。

#### 场景：双侧绿

- When：跑触及测试文件
- Then：全部通过

## 测试绑定（每条 FR 至少一行）

FR-01: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「duration_api_ms 跨轮累计快照差分」三用例
FR-02: backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py「test_close_duration_api_ms_over_wall_rejected」
FR-03: 上述文件全绿（daemon 44 / backend 3 passed）
