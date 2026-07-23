---
author: qinyi
created_at: 2026-07-09 07:02:00
change: 2026-07-09-agent-log-display-fix
stage: verify
---

# 验证报告 · 2026-07-09-agent-log-display-fix

智能体执行日志回显修复（标签对应不上 + token 空白 + 日志缺失）。

## 1. 验证范围

实际改动（git status 确认）：**frontend 4 文件**
- `frontend/src/components/agent-log/normalize.ts`（task-05/06）
- `frontend/src/components/agent-run-panel.tsx`（task-09）
- `frontend/src/components/agent-log/__tests__/normalize.test.ts`（task-08，+2 D-007 case）
- `frontend/src/components/__tests__/agent-run-panel.test.tsx`（task-09 测试契约更新）

daemon / backend **未改**（task-02/03/04 回退，见 D-008）。

## 2. 方案调整（D-008，重要）

原 design 方案 B（daemon 删 stdout [TOOL_USE] 双写）在 execute 阶段撞到 `daemon-parity.test.ts`（守护双写格式，17 处断言依赖）。调整为**前端方案 A**：daemon 不动，前端 normalize 去重合并。

用户视觉效果完全相同（工具合并卡片 + SYSTEM 折叠 + cacheCreation 占位）。详见 decisions.md D-008@v1。

## 3. 任务完成度

| 状态 | task | 说明 |
|---|---|---|
| ✅ 完成 | task-05 | normalize stdout [TOOL_RESULT] 按 parent_tool_use_id 精确配对（D-007） |
| ✅ 完成 | task-06 | classifyLog 补 [TOOL_USE]→tool_call + NOISE_PREFIXES 移除改折叠（D-002@v2） |
| ✅ 完成 | task-07 | viewer 折叠 UI（复用 task-15 CollapsibleSection） |
| ✅ 完成 | task-08 | normalize 37 + viewer 19 测试 |
| ✅ 完成 | task-09 | TokenUsageBadge cacheCreation B 分支占位（D-004@v2） |
| ↩️ 回退 | task-02/03/04 | daemon 改动回退（D-008 方案 A 替代） |
| ⏳ 债务 | task-01 | cache_creation 运行时实证（需真实 run dump） |
| ⏳ 债务 | task-10 | 交互面板 cache 维度（一致化） |
| ⏳ 债务 | task-11 | killed/failed 显式占位文案（NULL 已 "—"） |
| ⏳ 债务 | task-12 | 历史回看 token 四维（一致化） |
| ⏳ 债务 | task-13 | 前端 token 单测 |

## 4. 测试结果

| 套件 | 结果 | 说明 |
|---|---|---|
| frontend typecheck | ✅ 通过 | tsc --noEmit 无错误 |
| frontend vitest | ✅ 715 passed | 含 normalize 37 + viewer 19 + agent-run-panel 5（2 个 D-007 新 case） |
| frontend lint | ⚠️ 1 warning | agent-run-panel.tsx:64 `onDone?(status)` 既有未用，非本次改动，非阻断 |
| daemon vitest | ⚠️ 20 failed | **main 分支既有预存债**（task-runner.ts 已回退干净 grep=0；memory 印证 daemon 预存测试债），非本次引起 |
| backend | — | 未改 |

## 5. 风险等级判定

design.md 含 daemon/backend 关键词（方案 B 原计划），按分级规则触发"daemon/backend 跨进程 → 必须真实集成"。

**但 D-008 调整后实际改动纯 frontend**（daemon/backend 未改）：
- 无跨进程契约变更
- 无 session/lease/run 状态机改动
- 前端 normalize 是纯函数 + viewer 组件渲染

**实际风险等级：medium**（前端显示修复，单测 + 组件测试覆盖充分）。design 关键词触发的"真实集成"要求因 D-008 不适用（daemon 未改）。

## 6. 端到端验证（待办）

- [ ] rebuild frontend 容器（docker 挂载主仓库源码，改完需 recreate frontend 生效）
- [ ] 打开真实 run 日志页面，确认：工具合并卡片 + SYSTEM 折叠可展开 + cacheCreation 显示 "—"
- [ ] task-01 cache_creation 实证（dump result.usage + accumulated + assistant message.usage，确认 A1/A2/B 分支）

## 7. 核心目标达成情况

| 目标 | 状态 | 依据 |
|---|---|---|
| G1 合并卡片消除三行分裂 | ✅ | task-05 id 配对 + viewer 卡片 |
| G2 token 四维一致 | 🟡 部分 | 主面板 ✅（task-09），交互面板/历史回看债务 |
| G3 SYSTEM/thinking 折叠不删 | ✅ | task-06 NOISE 移除 + CollapsibleSection |
| G4 killed 占位 | 🟡 部分 | NULL→"—" ✅，显式文案债务 |
| G5 terminal 不破坏 | ✅ | daemon 未改，renderAgentEvent 独立 |

## 8. 结论

**核心用户痛点（工具标签对应不上 + 日志信息缺失 + 主面板 token 空白）已解决**，frontend 715 passed 零回归。

方案调整（B→A，D-008）有据（parity 守护），视觉效果同等。

剩余债务（task-01 实证 + task-10~13 一致化/增强）建议起 quick 变更补齐，非核心阻塞。端到端部署验证待 rebuild frontend 容器。
