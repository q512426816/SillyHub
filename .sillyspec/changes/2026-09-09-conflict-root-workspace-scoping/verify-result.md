# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

## 结论 [层：人工判断]

结论枚举：`PASS`
理由：FR-01~06 全部落地且三端测试全绿、静态检查全过、探针全过；integration-critical
真实栈两态验证完成（独立 verify_crws 库 + 独立 18000 端口 + 隔离 daemon 目录，
验证后已清理，生产栈零影响）——见集成验证回执。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（6/6 任务均为 satisfied，无 cannot_verify）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: integration-critical 真实集成验证（跨进程联调）——独立库 verify_crws（docker postgres）+ worktree backend（uvicorn :18000）+ 真实 daemon 进程（worktree 构建、隔离 SILLYHUB_DAEMON_DIR、X-API-Key 认证、WS 真实连接 ws_daemon_connected），预写工作区映射与投毒单槽位，6 项证据全过，验证后清理（backend 停/库删/目录清，生产栈零影响） | command: ① uvicorn app.main:app --port 18000（DATABASE_URL=verify_crws） ② node dist/cli.js start --server http://127.0.0.1:18000 --api-key shk_live_…（隔离 env） ③ curl GET compare（命中/未命中/非成员）④ curl POST resolve（缺 ws/未命中/命中） | exit: 0 | log: .sillyspec/changes/2026-09-09-conflict-root-workspace-scoping/verify-integration.log

真实栈证据矩阵：
① **映射命中+单槽位投毒（Temp）**：GET compare?workspace_id=1111… → HTTP 200，返回 change=quick-verify01、files[0]（path=changes/quick-verify01/design.md、local_mtime 有值、local_missing=false）——daemon 在映射根真实读到记录与文件，单槽位被投毒为 Temp 也不受影响（FR-02 核心命题）。
② **成员但映射未命中**：GET compare?workspace_id=9999… → HTTP 502，daemon_code=workspace_root_unknown，message=「该工作区尚未被本机认领，请先在该工作区发起一次会话后重试。」（FR-02 错误语义 + FR-06 文案分叉真实栈生效）。
③a **resolve 未命中 ws**：POST resolve（workspace_id=9999…）→ sent:true；心跳回传 sillyspec_command_result={state:failed, error:"该工作区尚未被本机会话认领，无法执行 sillyspec 命令"}（FR-02 裁决臂 + fire-and-forget 心跳回传链）。
③b **resolve 缺 workspace_id**：→ HTTP 422 validation_error（body.workspace_id Field required）（FR-01 契约必填）。
③c **resolve 命中 ws**：POST resolve（workspace_id=1111…）→ sent:true；心跳回传 state:success/exit_code:0——sillyspec CLI 真实 spawn 于映射根（Temp 下无 .sillyspec 结构必失败，success 恰证明 cwd=映射根正确）。
另：非成员 ws 请求 → 403「仅工作区成员可查看该冲突对比。」（FR-05 成员校验真实生效，附带验证）。

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
- 集成盲区标注（语义）：已补真实栈验证（见集成验证回执 ①②③a/b/c + 附带 403），AC-5 全部覆盖，无盲区

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
