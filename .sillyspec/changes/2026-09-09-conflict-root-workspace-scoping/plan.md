---
plan_level: full
---

# 实现计划（Plan）— 冲突对比/裁决按工作区取根

## Spike 前置验证

无（技术方案确定：参数透传 + Map 查根，全部锚点已在 brainstorm 阶段对源码验证；
无新技术栈/集成不确定性）。

## Wave 1（并行，无依赖）
- task-01
- task-03

## Wave 2（依赖前序 Wave）
- task-02
- task-04
- task-05

## Wave 3（依赖前序 Wave）
- task-06

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | sillyspec-manager workspaceId 参数化 + workspace_root_unknown 两态语义 + manager 侧测试 | W1 | P0 | — | FR-02, FR-03, D-001@v1 | statusRootFor 注入（Deps+构造）；conflictSnapshot 抛错 / runResolve failed 不 spawn；legacy 空串保持单槽位+no_spec_root |
| task-02 | daemon.ts 接线：RPC/RESOLVE 透传 + _noteSillySpecStatusRoot 防投毒 + heartbeat 测试 | W2 | P0 | task-01 | FR-01, FR-02, FR-04, D-001@v1 | statusRootFor 闭包注入；handler 归一空串=legacy；Executor 接口签名；无 ws claim 不覆盖单槽位 |
| task-03 | backend compare：_fetch_snapshot 透传 workspace_id + ensure_workspace_member 公开(action) + 测试 | W1 | P0 | — | FR-01, D-001@v1 | RPC params {change,kind,workspace_id}；方法公开+可选 action 参数，compare 调用点文案不变 |
| task-04 | backend resolve 契约：请求体必填 + WS payload + 成员校验 + 测试 | W2 | P0 | — | FR-01, FR-05, D-001@v1 | MachineSillySpecResolveRequest.uuid / send_sillyspec_resolve 加参 / 端点校验复用 task-03 公开方法（实现顺序上先跑 task-03 则直接可用，否则同文件先落方法再引用） |
| task-05 | 502 网关文案按 daemon_code 分叉（可选） | W2 | P2 | task-03 | FR-06 | workspace_root_unknown→「尚未被本机认领」/ conflict_record_missing→「记录已失效」；其余维持现状 |
| task-06 | pnpm gen:types + 前端弹窗 workspace_id 下传 + 测试 | W3 | P0 | task-04 | FR-01, D-001@v1 | 先确认前端 node_modules 健康（tsc --version）；api-types.ts + openapi.json 同步提交；modal resolve body 加 workspace_id |

注：task-03/task-04 同属 backend 且 task-04 复用 task-03 公开的方法——若串行执行
（03 先 04 后）最省心；并行执行需先落 `ensure_workspace_member` 公开改造（03 的
一部分），CLI Wave 分组不强制同 Wave 内并行，按 03→04 顺序做即可。

## 关键路径

task-01 → task-02 → task-06 与 task-04 → task-06（最长链：manager 参数化 →
daemon 接线 → 契约同步；backend 腿 W1 并行推进不阻塞）

## 全局验收标准

1. daemon：`pnpm test`（sillyhub-daemon）中 sillyspec-conflict-snapshot /
   sillyspec-platform-command / daemon-heartbeat-sillyspec 相关用例全绿
   （含新增：映射取根、未命中两态、legacy 回退、无 ws claim 不覆盖单槽位、
   有 ws 双写不变）。
2. backend：`uv run pytest`（仅本模块相关文件）test_sillyspec_compare /
   test_sillyspec_platform_commands 相关用例全绿（RPC params 断言、请求体必填
   422、成员校验 403、payload 透传）。
3. frontend：conflict-compare-modal 测试断言 resolve 请求体带 workspace_id。
4. 契约：`pnpm gen:types` 后 `gen:types:check` 无 diff（api-types.ts +
   openapi.json 同步提交）。
5. 集成（integration-critical 判级要求）：verify 阶段真实起 daemon+backend 栈，
   验证 ① 映射命中时对比返回快照 ② 未命中返回 workspace_root_unknown ③ 单槽位
   投毒后新路径不受影响。
6. brownfield：无 workspace_id 的旧调用形态（legacy）行为不变（单测覆盖回归）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-04, task-06 | AC-1~AC-6（全局验收标准 1-6） |
