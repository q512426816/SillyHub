---
author: qinyi
created_at: 2026-10-12T10:05:00.000Z
---
# 需求规格（Requirements）— 2026-10-12-duration-backfill-harness-align

## 功能需求

### FR-01: close 对 duration_api_ms 仅回填不覆盖

close_interactive_run 必须在 `AgentRun.duration_api_ms` 列已有值（实时窗口
累计实测值）时不覆盖；列 NULL 时才以 close 元数据回填（api > 墙钟合法——子代理
并行时 Σ窗口>墙钟，禁止设墙钟守卫）。

#### 场景：实测值权威

- Given：列已预写 11800（实时累计），close 入参 duration_api_ms=3171192
- When：close_interactive_run
- Then：列保持 11800

#### 场景：NULL 回填

- Given：列 NULL，close 入参 duration_api_ms=3171192
- When：close_interactive_run
- Then：列写入 3171192

### FR-02: 模块卡语义同步

backend daemon 模块卡 usage 管线段必须同步回填语义与 harness 对齐说明。

#### 场景：卡面一致

- When：读 backend daemon.md usage 管线段
- Then：描述为「close 元数据仅回填不覆盖实测值；Σ窗口>墙钟合法无守卫」

### FR-03: 相关测试通过（不跑全量）

改写后的 lifecycle 用例（回填/不覆盖）必须全绿；禁止运行全量测试套件。

#### 场景：绿

- When：跑 lifecycle duration_api 用例
- Then：全过

## 测试绑定（每条 FR 至少一行）

FR-01: backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py「test_close_backfills_duration_api_ms_when_null」「test_close_does_not_override_measured_duration_api_ms」
FR-02: .sillyspec/docs/backend/modules/daemon.md（usage 管线段人工核对）
FR-03: backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py -k duration_api 全绿
