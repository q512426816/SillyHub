---
plan_level: full
---

# 实现计划（Plan）：会话上下文压缩（平台级 /compact）

## Spike 前置验证（如需要）

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | 真机 pi 会话跑一轮 compact（driver `_sendCommand` 形态脚本直驱）确认 response 回执字段名（tokensBefore/estimatedTokensAfter）与 compaction 事件时序 | task-04 字段名校正；机制不变 |
| spike-02 | 真机 codex app-server 发 thread/compact/start 确认参数命名（threadId camelCase）与响应形态 | task-05 参数名校正；机制不变 |

> 两 spike 并入 task-07 真机验证（设计 R-01/02/03 已配降级路径），不阻塞实现。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02
- task-03

## Wave 3（依赖前序 Wave）
- task-04
- task-05
- task-06

## Wave 4（依赖前序 Wave）
- task-07

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | caps 第 12 键 compact 三端贯通 | W1 | P0 | — | FR-01, D-001 | providers 三处+gen 脚本+两 @generated+alignment len==12×2+registry twelveKeys+picker 两 toEqual+adapter 注释（八步样板） |
| task-02 | backend compact 端点双分路 + gen:types | W2 | P0 | task-01 | FR-02, D-002/D-003@v3/D-004 | session_crud 端点（三校验 get_provider_caps["compact"]+claude inject 复用+TurnConflict 映射+pi/codex send_rpc+Offline/Timeout/RemoteError 三映射+Conflict 500 兜底句）+schema DTO+gen:types；service 落点=backend/app/modules/daemon/session/service/compact.py（照 inject.py 先例）；测试 NEW:backend/app/modules/daemon/tests/test_session_compact_endpoint.py |
| task-03 | daemon RPC handler + session-manager compact + driver 契约 | W2 | P0 | task-01 | FR-02/04/05 | registerRpcHandler('session_compact')（daemon.ts 既有注册组旁；_sessionManager 为 null 时 throw→RemoteError，AC-14 先例）+compact() 六守卫+driver.ts 可选 compact?()/CompactResult；测试 NEW session-compact.test.ts |
| task-04 | PiRpcDriver.compact() | W3 | P0 | task-03 | FR-04 | _sendCommand compact 等 response+回执+10s 超时；pi-rpc-driver.test 断言 |
| task-05 | CodexAppServerDriver.compact() + pending 机制 | W3 | P0 | task-03 | FR-05 | 新 id→pending map（pi 先例）+thread/compact/start 等 response；独立单测+既有套件回归（R-06） |
| task-06 | 前端按钮与通知 | W3 | P0 | task-01, task-02 | FR-06/07, D-004 | compactSession API+环浮层 onCompact 三态+三分型通知+vitest（page-only 挂载——dialog 无 ctx 环不挂，plan-review P1-2；测试落点=ctx-usage-bar.test.tsx 扩展+session-panel 相关既有测试文件） |
| task-07 | 文档 + 真机三引擎验证（含 spike-01/02） | W4 | P0 | task-02,04,05,06 | FR-08, R-01/02/03 | onboarding 指引+真机结论记 QUICKLOG；claude 不生效则 caps 降 false 重生成（R-01 降级路径） |

## 关键路径

task-01 → task-03 → task-05 → task-07（helper：caps → daemon 契约 → codex（最重新机制）→ 真机收口）

## 全局验收标准

1. caps 三端逐值一致+双守护绿+pre-session-picker 绿+生成幂等（两连跑逐字节一致）
2. backend：端点三校验/claude 分路建 run（TurnConflict 映射）/pi·codex 分路 RPC（三异常映射）pytest 绿
3. daemon：RPC handler 注册+六守卫+pi 回执+codex pending 机制+既有相关套件零回归+typecheck
4. frontend：三分支 vitest+tsc+eslint；api-types 含新端点
5. 真机：pi 通知带数字/claude 会话流压缩轮+通知/codex 受理通知；三引擎下一轮环回落；QUICKLOG 回执
6. brownfield：旧 daemon RemoteError 结构化 error、cursor/未知引擎按钮不渲染+端点拒绝、既有端点与 AgentEvent schema 零变化
7. 集成冒烟：RPC 全链（backend send_rpc → daemon handler → driver → result 回传）测试或真机证据

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | 全任务（范围约束） | 全局验收 1-7 |
| D-002@v1 | task-02/03/06 | 验收 2/3/4（三层空闲守卫） |
| D-003@v3 | task-02/03/04/05 | 验收 2/3/7（双分路+RPC 回传） |
| D-004@v1 | task-02/06 | 验收 4（三分型通知） |
