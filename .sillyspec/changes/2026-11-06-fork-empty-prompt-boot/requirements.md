---
author: flow-machine-draft
created_at: 2026-11-06T15:11:33.328Z
---
# 需求规格（Requirements）— 2026-11-06-fork-empty-prompt-boot

## 功能需求

### FR-01: daemon 空 prompt 守卫对 fork lease 豁免

- daemon `_startInteractiveSession` 收到 `forkSession === true` 的 interactive lease 且 `prompt` 为空串时，**必须**继续调 `SessionManager.create` 建立引擎会话（`firstPrompt` 透传空串），**禁止**以 interactive_missing_fields 早退。

#### 场景：fork lease 空 prompt 正常建会话

Given claim payload 携带 `fork_session: true` + `fork_mode: resume_at` + `resume_at_uuid` 且 `prompt: ""`；When daemon 认领该 lease；Then SessionManager.create 被调用且收到 `firstPrompt=""`（不挂 10s 空消息兜底，首轮由用户首问 inject 驱动）。

### FR-02: 非 fork lease 空 prompt 仍早退并回报失败

- 非 fork lease（claim payload 无 `fork_session` 键）`prompt` 为空时，daemon **必须**维持 interactive_missing_fields 早退不建会话，且在 claimToken/sessionId/runId 齐备时**必须**回报 `notifyRunResult(status=error_during_execution)`，**禁止**裸 return 让 run 挂到 300s 僵尸轮清扫。

#### 场景：非 fork 空 prompt 早退 + run failed 回报

Given claim payload 仅 `prompt: ""`（无 fork 键）；When daemon 认领；Then SessionManager.create 不被调用，且 notifyRunResult 以 error_during_execution 上报该 run。

### FR-03: fork 建 B 继承源会话 cwd（不伪造）

- backend `fork_session` 建分叉会话 B 时，若 workspace 派生链（workspace_id → ws.root_path）未产出 cwd 且源会话 `source.cwd` 有值，则 B **必须**落该值；源 cwd 为 None 时 B **必须**保持 None，**禁止**伪造默认目录。

#### 场景：源 cwd 有值无 workspace → B 继承

Given 源会话 cwd="/tmp/platform-managed-root" 且 workspace_id 为空；When fork；Then B.cwd 同值。

#### 场景：源 cwd 为 None → B 保持 None

Given 非工作区源会话（cwd=None）；When fork；Then B.cwd 为 None（默认目录分配归 2026-11-06-session-reopen-no-cwd）。

#### 场景：工作区源会话 → 派生链优先同值

Given 源会话挂工作区（cwd=ws.root_path）；When fork；Then B.cwd 经 workspace_id 派生链落 ws.root_path（显式继承不覆盖派生值）。

### FR-04: 相关测试全绿（不跑全量）

- 本变更**必须**只运行触及面的测试（backend test_session_fork.py 全文件 + daemon session-fork.test.ts 全文件）并全绿，**禁止**顺跑全量测试（留给 CI）。

#### 场景：主路径

Given 两端实现与测试就位；When 分别运行上述两个测试文件；Then 全部用例通过（backend 27 / daemon 17）。

### FR-05: 静态检查零告警

- 触及文件**必须**通过 ruff（backend 三个文件 All checks passed）与 `tsc --noEmit`（daemon 无 eslint 脚本，以 typecheck 为准）。

#### 场景：主路径

Given 改动完成；When 运行 ruff check 与 pnpm typecheck；Then 零告警零报错。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/session-fork.test.ts「fork lease（fork_session=true）prompt 为空 → 正常建会话（firstPrompt=""，不再 interactive_missing_fields 早退）」
FR-02: sillyhub-daemon/tests/session-fork.test.ts「非 fork lease 空 prompt → 仍早退不建会话，且回报 run failed（防 run 永久 pending）」
FR-03: backend/app/modules/daemon/tests/test_session_fork.py::TestForkCwdInheritance「test_source_cwd_without_workspace_inherited / test_source_cwd_none_stays_none / test_workspace_source_cwd_consistent」
FR-04: 不适用：FR-04 本身是测试执行约束（无独立被测代码），其成立性由 FR-01~03/05 的测试绑定与执行结果承载
FR-05: 不适用：静态检查命令（ruff/tsc）非测试用例，执行结果见 tasks.md 收口记录
