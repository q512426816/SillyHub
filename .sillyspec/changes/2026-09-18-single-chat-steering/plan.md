---
plan_level: full
author: qinyi
created_at: 2026-09-19 00:35:00
---

# 实现计划（Plan）— 单聊引导（Steering）忙轮直注入

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01（=task-02） | codex 0.147.0 app-server `turn/steer` 参数格式实机探测（本机手工 JSON-RPC 会话） | 拿到可用的请求参数形状与响应/错误回执样例，落盘探测记录 | codex caps 置 false 降级收尾——**caps 翻值回改三端产物归 task-01 收尾**（同 Wave 串行收口）；task-03 取消，task-09 对 task-03 的依赖边与 codex 单测范围自动豁免（依赖列改写为 task-05~08） |
| spike-02（=task-04） | claude SDK 0.3.247 忙轮推流后命令队列 mid-turn 吸收实测 | queued_turn_count ≥1 且未 interrupt，消息在下一次 LLM 调用前生效（证据落盘） | claude 驱动行为=轮边界消费（降级可接受）；**caps 取值按实测结论回改归 task-01 收尾**；前端「引导中」态照常工作 |

## Wave 1（能力基座 + 双 Spike，并行）

- task-01
- task-02
- task-04

## Wave 2（daemon codex 接线）

- task-03

## Wave 3（backend 派发链改造）

- task-05
- task-06

## Wave 4（前端状态与文案）

- task-07
- task-08

## Wave 5（三端测试收口）

- task-09

## Wave 6（文档与验收）

- task-10

## 任务总表

| ID | 任务名 | Wave | 优先级 | 依赖 | 覆盖 | target_files |
|---|---|---|---|---|---|---|
| task-01 | PROVIDER_CAPS 新增 steering 第 14 键（单源 + 三端生成 + alignment） | W1 | P0 | — | FR-02, D-003@v1 | sillyhub-daemon/src/interactive/providers.ts; sillyhub-daemon/scripts/gen-provider-caps.mjs; sillyhub-daemon/tests/interactive/provider-registry.test.ts; backend/app/modules/agent/provider_caps.py; backend/app/modules/agent/tests/test_provider_caps_alignment.py; frontend/src/lib/provider-caps.ts; frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx |
| task-02 | codex turn/steer 实机探测（spike-01，结论落盘） | W1 | P0 | — | FR-06, D-003@v1, R-02 | .sillyspec/changes/2026-09-18-single-chat-steering/spike-codex-turn-steer.md |
| task-04 | claude SDK 队列吸收实测（spike-02，证据落盘） | W1 | P1 | — | FR-01, D-003@v1, R-01 | .sillyspec/changes/2026-09-18-single-chat-steering/spike-claude-steering.md; sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts |
| task-03 | codex 驱动输入循环接 turn/steer 分支（含被拒回落单测） | W2 | P0 | task-02 | FR-06 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts; sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts |
| task-05 | backend 单聊忙轮改 busy_strategy=inject + 能力门控 + steered 映射 | W3 | P0 | task-01 | FR-01, FR-02, D-001@v1, D-002@v1 | backend/app/modules/daemon/router/session_crud.py; backend/app/modules/daemon/session/service/inject.py; backend/app/modules/daemon/session/service/__init__.py; backend/app/modules/daemon/service.py |
| task-06 | backend dispatch_now 引导式重构 + dispatch_mode 三态 | W3 | P0 | task-01 | FR-03 | backend/app/modules/daemon/session/service/queue.py; backend/app/modules/daemon/router/session_queue.py; backend/app/modules/daemon/schema.py |
| task-07 | 前端忙轮发送引导状态（引导中/已引导/终态收敛） | W4 | P0 | task-05 | FR-05 | frontend/src/lib/daemon/sessions.ts; frontend/src/components/daemon/session-panel/session-panel-page.tsx; frontend/src/components/daemon/session-panel/session-panel-dialog.tsx |
| task-08 | 前端队列条 ⚡ 引导语义 + 降级标注（消费 task-06 产出的 dispatch_mode 三态） | W4 | P1 | task-06 | FR-03, FR-05, FR-02 | frontend/src/components/daemon/message-queue-bar.tsx |
| task-09 | 三端测试收口 + api-types 重生成 | W5 | P0 | task-03, task-05, task-06, task-07, task-08 | FR-04 | frontend/src/lib/api-types.ts; backend/app/modules/daemon/tests/test_session_queue.py; backend/app/modules/daemon/tests/test_session_queue_actions.py; frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx; frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx; frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx; backend/app/modules/daemon/session/service/__init__.py; backend/app/modules/daemon/service.py |
| task-10 | 模块文档同步 + verify 对照验收 | W6 | P1 | task-09 | FR-04 | .sillyspec/docs/SillyHub/modules/daemon.md |

## 关键路径

task-01 → task-05 → task-07 → task-09 → task-10（backend→frontend 主线；task-02→task-03 支线与主线并行，汇于 task-09）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 能力矩阵单源：daemon providers.ts PROVIDER_CAPS 为唯一维护源，backend provider_caps.py / frontend provider-caps.ts 均为 gen-provider-caps.mjs 生成产物，不手改生成物；不新建手维护常量、不加 driver 契约属性、不设 daemon 中心化门控任务。
- 复用既有 `mid_turn` 字段（results.py:39），不新建平行 steered 服务层字段；inject 响应 steered 仅在 router 层映射；dispatch_now 现有 `interrupted: bool` 保留兼容不删。
- 不新建持久化生命周期（无新表/新状态列）；排队表与 run 状态机沿用既有，仅 dispatch_now 转移路径增加「mid-turn 注入活跃 run」分支。
- 停止按钮 interrupt 语义、带切换维度消息排队/409 语义、群聊 @ steering、scheduled send、服务身份 409——零回归。
- 前端接口类型 api-types.ts 必须从后端 OpenAPI 生成（pnpm gen:types，先确认 node_modules 健康）；frontend/src/lib/daemon/sessions.ts 手写镜像同步手补。
- 禁止跑全量测试，仅跑自己修改相关的测试；代码兼容 Windows/Linux/macOS；UI 文案中文。
- codex turn/steer 被拒必须回落轮边界消费（不报错不挂死）；未知 provider 默认 false。

## 全局验收标准

1. 相关单测全部通过（backend 忙轮三分支/dispatch_now、daemon codex turn-steer、前端组件测试）
2. 集成冒烟（integration-critical 判级强制）：codex 实机 turn/steer 探测记录 + 至少一条单聊忙轮端到端引导用例（真 daemon 会话）
3. 群聊 @ steering、cursor/未知 provider 排队、⚡ 不支持引擎 interrupt 接力——既有行为回归用例通过
4. PROVIDER_CAPS alignment 测试通过（steering 键三端一致）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-06, task-07, task-08 | FR-01/03/05 场景用例 + 集成冒烟 |
| D-002@v1 | task-01, task-05, task-06 | FR-02 降级用例 + alignment 测试 |
| D-003@v1 | task-01, task-02, task-03, task-04 | spike-01/02 探测记录落盘 + caps 键三端一致 |
| FR-01 | task-04, task-05 | test_session_queue.py 新用例 + spike-02 证据 |
| FR-02 | task-01, task-05, task-08 | alignment 测试 + 降级用例 |
| FR-03 | task-06, task-08 | test_session_queue_actions.py + message-queue-bar 测试 |
| FR-04 | task-09, task-10 | 回归用例 + verify-result |
| FR-05 | task-07, task-08 | 前端组件测试 |
| FR-06 | task-02, task-03 | spike 记录 + codex 驱动单测 |
