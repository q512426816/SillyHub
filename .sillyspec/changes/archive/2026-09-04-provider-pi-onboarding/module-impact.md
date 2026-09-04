---
author: qinyi
created_at: 2026-09-04 11:50:00
---
# 模块影响分析（Module Impact）— PI 交互式 Provider 接入（档C 首战）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| sillyhub-daemon:interactive | 新增+修改 | pi-events.ts 归一化器+pi-rpc-driver.ts（rpc 长驻 driver：核心 task-02+高级语义 task-03+subagent 实证 task-06 分层修改）；providers.ts 加 pi 条目+caps 键（W1 建 W6 可能翻 subagent 值） |
| sillyhub-daemon:cli | 修改 | drivers 装配加 pi: new PiRpcDriver() 一行（B-01：_getDriver 走 deps.drivers 注入） |
| sillyhub-daemon:detector | 修改 | PROVIDER_SPECS.pi 补 minVersion '0.81.0'（档B 既有步骤） |
| backend:agent | 修改 | provider_caps.py 镜像加 pi 键（含 task-06 可能的 subagent 翻值）；对齐守护测试 EXPECTED_PROVIDERS 补 pi |
| frontend:components-sessions | 修改 | pre-session-picker.tsx 引擎白名单加 pi（B-02 门户主路径） |
| frontend:components-daemon | 修改 | runtime-session-helpers.tsx 引擎白名单加 pi（B-02 对话框路径） |
| frontend:lib | 修改 | provider-caps.ts 镜像加 pi 键 |
| docs | 修改 | agent-provider-onboarding.md 档C PI 案例锚+档B 盲区顺修 |
| （不变区）SessionManager/daemon.ts/backend session service/前端 caps 门控 | 不变 | 四承诺区零改动（抽象层红利，Grill 实读核实）；批量 adapters/pi-json.ts 不动 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| sillyhub-daemon/tests/fixtures/pi-rpc-events/ | 冒烟/单测 fixture（task-01 建），测试资产非模块 |
| sillyhub-daemon 分发目录 vendored subagent 扩展（task-06 若采纳 vendor 方案） | 随 daemon bundle 分发的第三方扩展拷贝，非平台源码模块 |
| .sillyspec/changes/2026-09-04-provider-pi-onboarding/smoke-result.md | 变更产物（task-07） |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/sillyhub-daemon.md`（interactive/cli/detector） | verify 阶段补 PiRpcDriver/PiEventNormalizer/caps pi 语义说明 | pending（verify 阶段执行） |
| `modules/backend.md`（agent 模块） | verify 阶段补 provider_caps pi 键说明 | pending（verify 阶段执行） |
| `modules/frontend.md`（components-sessions/lib） | verify 阶段补引擎白名单与 provider-caps pi 说明 | pending（verify 阶段执行） |
| `_module-map.yaml` | 无增删模块；main_symbols 可在 verify 补 PiRpcDriver/INTERACTIVE_PROVIDERS pi 条目 | pending（verify 阶段评估） |
