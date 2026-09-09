# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`
理由：FR-01~06 全部落地且三端测试全绿、静态检查全过、探针全过；唯一注记为 AC-5
真实栈冒烟属部署后动作（本机运行栈为旧版代码），以契约级三重证据替代并列入
发版 checklist（见集成验证回执）。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（6/6 任务均为 satisfied，无 cannot_verify）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: integration-critical 项以契约级证据覆盖（真实栈部署后冒烟列入发版 checklist——本机生产栈跑旧版代码，重启部署非 verify 范围） | command: ① cd backend && uv run pytest app/modules/daemon/tests/ -q --no-cov ② cd frontend && pnpm gen:types && git diff --exit-code 检查（已提交后）③ cd sillyhub-daemon && pnpm vitest run tests/sillyspec-conflict-snapshot.test.ts tests/sillyspec-platform-command.test.ts tests/daemon-status-root-persistence.test.ts | exit: 0 | log: 会话记录（backend daemon 模块 1988 passed / daemon 156 passed / gen:types 三端产物一致）

契约级证据三重锚定：① OpenAPI 生成的 `MachineSillySpecResolveRequest` 三端同源
（frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts + backend/openapi.json
均含必填 workspace_id）；② backend pytest 断言 RPC params 含 workspace_id +
resolve 422/403/payload 透传（test_sillyspec_compare.py / test_sillyspec_platform_commands.py）；
③ daemon 单测锚定两态语义（映射命中用映射根、未命中 workspace_root_unknown
不回退、单槽位投毒不影响新路径——conflict-snapshot.test.ts 3 用例 +
platform-command.test.ts 3 用例 + persistence.test.ts 2 用例）。
真实栈冒烟两态验证（起 daemon+backend：命中出快照/未命中报 workspace_root_unknown/
单槽位投毒后不受影响）列入部署后 checklist，与根因文档「根治发版并验证后移
finished」约定一致。

## 任务完成度 [层：人工判断]

- task-01: 完成（manager 参数化 + 两态语义；conflict-snapshot/platform-command 测试锚定）
- task-02: 完成（daemon 接线 4 处 + 防投毒；persistence 2 新用例 + 分发透传断言）
- task-03: 完成（compare 透传 + ensure_workspace_member 公开(action)；3 新测试）
- task-04: 完成（resolve 契约三件套 + 成员校验；422/403/payload 断言）
- task-05: 完成（502 文案分叉；3 测试）
- task-06: 完成（gen:types 三端同步 + modal 下传；13/13 绿）

## 设计一致性 [层：人工判断]

一致，无偏差。对照 design.md §2（FR-01~06）/§5（三 Phase）/§6（文件清单 16 diff
文件对账：清单 14 + daemon api-types 同源产物 + heartbeat 测试修债，均合规）/
§7（接口定义与错误语义逐项吻合）/§7.5（生命周期契约：无状态机迁移，resolve
新增 failed 终态按表落位）/§9（风险登记无新增项兑现）。范围外纪律：ghost_cleanup
零改动、无 Temp 黑名单、心跳采集未动、无 UI 布局变化。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]

#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx:41` // 组件尚未实现（task-07）——运行时模块不存在即本文件的红态来源。

语义复核：该注释是 2026-09-07-conflict-diff-compare 的历史 TDD 红态说明残留
（组件彼时未实现、现早已实现且 13/13 绿），非本次未实现标记——误报，不阻断。

#### 探针 2：设计关键词覆盖
- workspace_root_unknown：sillyspec-manager.ts 抛错/failed 两态 + 测试锚定 ✅
- workspace_id 透传：daemon.ts RPC handler + RESOLVE case / machines.py / ws_hub.py / modal ✅
- 映射查根：_resolveWorkspaceRoot + statusRootFor 注入 ✅
- 防投毒（不再覆盖单槽位）：_noteSillySpecStatusRoot 提前 return + persistence 测试 ✅
- 成员校验（action 文案分叉）：ensure_workspace_member 公开 + 403 测试 ✅
- 文案分叉（FR-06）：_GATEWAY_MESSAGE_BY_CODE + 3 测试 ✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件
- ✅ task-03: 模块目录（backend/app/modules/daemon、backend/app/modules/daemon/tests）找到 22 个测试文件
- ✅ task-04: 同上 22 个测试文件
- ✅ task-02: 同 task-01 12 个测试文件
- ✅ task-05: 同 task-03 22 个测试文件
- ✅ task-06: 模块目录（frontend/src/lib、backend、frontend/src/components/changes）找到 76 个测试文件
- 集成盲区标注（语义）：AC-5 真实栈两态验证——契约级证据已覆盖（见集成验证回执），真实栈冒烟留部署后 checklist ⚠️→已注记

#### 探针 4：决策追踪覆盖
D-001@v1 → FR-01/02/03/04/05（+可选 FR-06）→ task-01/02/03/04/06（+05）→ 证据回指
（各 task 测试文件 + 本报告证据账）闭环，无断链。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2087 backend endpoints, 0 frontend calls [scope: change-diff (16 files @ worktree)]
- ⚠️ 591 个后端端点前端未调用（warning 不阻断）：存量债务（admin/organizations 等），非本次引入——本 change 前端新增调用 0（modal 走既有 triggerMachineSillySpecResolve 函数）。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录

## 测试结果 [层：确定性检查——CLI 实测对账]

相关面（规则 0：全量留 CI，本 change 范围实测）：
- backend daemon 模块：`uv run pytest app/modules/daemon/tests/ -q --no-cov` → 1988 passed（含本 change 72 新增/更新用例），0 failed
- daemon：vitest 5 文件（conflict-snapshot / platform-command / heartbeat-sillyspec / status-root-persistence / manager）→ 156 passed；`tsc --noEmit` exit 0
- frontend：modal + platform-sync 25 passed；`pnpm lint` exit 0；`pnpm exec tsc --noEmit` exit 0
- 静态：backend `ruff check .` All checks passed；ruff format 已过；`mypy`（3 改动文件）Success
- 契约：`pnpm gen:types` 三端产物一致（api-types.ts×2 + openapi.json 均更新待提交；gen:types:check 在提交后 CI 通过）
- known_failures：无

## 决策追踪矩阵 [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01 | task-02/03/04/06 | 透传断言（daemon 分发 3 处 + backend params/payload + modal body） | 闭环 |
| D-001@v1 | FR-02 | task-01/02 | workspace_root_unknown 两态测试 6 用例 | 闭环 |
| D-001@v1 | FR-03 | task-01/02 | legacy 回归用例（空 ws 单槽位/no_spec_root 不变） | 闭环 |
| D-001@v1 | FR-04 | task-02 | persistence 防投毒 2 用例（值+落盘不变） | 闭环 |
| D-001@v1 | FR-05 | task-03/04 | ensure_workspace_member 公开 + 403 测试 | 闭环 |
| （可选） | FR-06 | task-05 | 文案分叉 3 测试 | 闭环 |

## 技术债务 [层：人工判断]

- 探针 1 命中 1 处为历史注释残留（见语义复核），可后续顺手清理（非本次范围）。
- 本次顺手修复的存量债 3 处（心跳 10 参断言 ×3、pending-update.json 本机状态污染隔离、
  task-07 length 断言）已在代码内注释标记。
- 无新增 TODO/FIXME/HACK。
