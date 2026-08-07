---
author: qinyi
created_at: 2026-08-07 09:55:00
stage: verify
change: 2026-08-06-public-mcp-server
---

# Verify 结论 — 对外暴露生产级 MCP 给第三方

> verify 阶段实测于 2026-08-07。本变更已 execute（Stage Review Gate 通过，worktree 16+ commit）。本文件记录 verify 阶段 apply + 代码级 evidence + 三项端到端真实环境复核的结果。

## 0. apply（verify 前置）

- `sillyspec worktree apply`（默认 patch --3way）把 worktree 37 个交付文件应用到 main 工作区（未提交）。
- **踩坑 + 修复**：apply 的 manifest 校验（Gate1，pathMatches 容差）与 patch 圈定（patchFiles，字面 `includes`）口径不一致——§6 用 glob 覆盖的 **7 个 mcp_gateway 测试文件**过校验但进不了 patch，apply 报告误显"已应用"实则未落盘。从 apply 前安全网 tag `pre-apply-2026-08-06-public-mcp-server` `git show` 逐个恢复。缺陷已记 `docs/sillyspec/apply-glob-manifest-passes-check-but-not-patch.md`（规则15）。
- §6 manifest 补登 7 个真实交付物（迁移真实文件名 / 测试 `__init__.py` / agent+daemon 跨模块测试 / uv.lock / 2 个 spike）——manifest 账目订正，非设计决策变更（不触发 §8.2 brainstorm --reopen）。

## 1. 代码级 evidence（全绿，复跑确认无回归）

| 项 | 命令 | 结果 |
|---|---|---|
| mcp_gateway 全模块 | `uv run python -m pytest app/modules/mcp_gateway -q --no-cov` | **72 passed** |
| daemon 模块（含 CC-08 complete_lease webhook 钩子） | `uv run python -m pytest app/modules/daemon -q --no-cov` | **739 passed** |
| FR-04 dispatch 绑 profile | `uv run python -m pytest app/modules/agent/tests/test_dispatch_profile.py` | **16 passed** |
| ruff | `uv run ruff check app/modules/mcp_gateway …` | **All checks passed** |
| alembic 可逆 | `upgrade head` → `downgrade -1` → `upgrade head` | **可逆**（mcp_tokens / mcp_webhooks / agent_runs.read_only 建删建均成功） |

> 坑：main 的 backend venv 原本**未装 pytest**（在 `[project.optional-dependencies] dev` extra），`uv sync` 默认不装 → `uv run pytest` 回退系统 pytest（无 mcp）报 `No module named 'mcp'`。`uv sync --extra dev` 修复。后续跑测试用 `uv run python -m pytest`（强制 venv python）。

## 2. 端到端 ② 真实 MCP client 闭环（完全验证 ✓✓）

真实 mcp SDK（v1.29.0）streamable_http client 连 backend `/mcp/`：

| 检查 | 结果 |
|---|---|
| initialize 握手 | ✅ server=sillyhub-public v1.29.0 proto=2025-11-25 |
| tools/list 返回 tool 数 | ✅ **恰好 8 tool**（list_agent_profiles / create_mission / dispatch_worker / list_workers / get_worker_result / get_run_logs / converge_mission / report_progress），无缺无余 |
| list_agent_profiles（read scope 真实 call） | ✅ 返回 2 个系统默认 profile（Claude Code / Codex） |
| **scope 403 拒绝** | ✅ READ-only token 调 create_mission（dispatch scope）→ `isError=True :: MCP token lacks required scope 'dispatch'` |
| **FR-04 闭环（DB 实证）** | ✅ dispatch_worker 绑定的 AgentRun：`agent_profile_id=857f7582…` + `agent_profile_snapshot`（冻结快照 has=True）+ `read_only=True` |
| dispatch_worker inputSchema 含 agent_profile_id | ✅ props 含 agent_profile_id（+ agent_type / mission_id / model / objective / read_only / role） |

## 3. 端到端 ③ webhook X-Signature（机制验证 ✓）

- **真实投递 + 验签**：`WebhookDispatcher.deliver()`（task-11/CC-08 生产代码）→ 解密 secret（deploy master key）→ HMAC-SHA256(body) → httpx POST 真实本地 receiver → **receiver 重算 HMAC 比对 `sig_valid=True`**，event=worker.completed / status=completed 正确投递。✅
- complete_lease 终态钩子（lease/service.py:631-669）**代码确认**：对 mission run 进 completed/failed/killed 时调 deliver，失败 try/except 不破坏 lease 完成；test_lease_service 单测覆盖（739 passed 内）。
- **真实终态驱动同 ① 受环境阻塞**（见下）——orchestrator 终态走 `interactive_run_closed` + POST /runs/{id}/result 路径而非 complete_lease，故 complete_lease→webhook 的真实终态投递本次未自然触发；worker（走 complete_lease 的）又卡 worktree RPC。

## 4. 端到端 ① 真实 read_only worker（发现缺陷 → 已修复 → 物制生效 ✓）

> 补跑（用户选"先补跑 ① 再 archive"）于 2026-08-07 发现 read_only 物制失效，根因 3 层，已在本变更内全部修复并实测验证。

**环境打通**：daemon 完整在线 + lease claim 成功（修 master key 不匹配：backend/.env 畸形 31 字节，真 key 在 deploy/.env）+ 修 workspace 绑定（workspace_member_runtimes.daemon_id 原绑旧 daemon 68c63051 不支持 host_fs git_worktree_add，rebind 到新 daemon 78cf1b41 后 worktree RPC 通）。

**发现的缺陷（read_only 物制失效）+ 3 层根因**：派 read_only worker 执行写文件目标，**文件真被创建**（Write/Bash 全放行）。逐层定位：
1. **backend `build_claim_payload`（lease/context.py）**：tool_config override 在文件末（~line 521），但 `kind=interactive` 分支（tar/shared 两路）提前 return，**永远到不了** → interactive lease（=所有 worker）claim payload 的 tool_config 恒为默认 `{}`。
2. **daemon `_startInteractiveSession`（daemon.ts）**：create 调用**没传 allowedTools**（且 execPayload 构造把 lease tool_config 映射到 camelCase `toolConfig`，非 snake）。
3. **daemon `session-manager._buildDriverOptions`**：ClaudeSdkDriver 的 `allowedTools` SDK 字段**非严格白名单**（无 canUseTool 时 headless 默认全批准；有写守卫时按路径放行 Write/Edit/Bash）→ 即使传了 allowedTools 也不限制。

spike-B 静态追码追到"stream-json.ts:333 消费 allowed_tools（路径存在）"，但 worker 实际走 interactive（非 batch stream-json），且上述 3 层数据流/语义断点都没验，漏判。

**修复（本变更内，3 处）**：
- `backend/app/modules/daemon/lease/context.py`：tool_config override 提前到所有 kind 分支之前（interactive + batch 都透传 lease metadata 的 tool_config）。
- `sillyhub-daemon/src/daemon.ts`：`_startInteractiveSession` 的 SessionManager.create 加 `allowedTools: execPayload.toolConfig?.allowed_tools`（读已映射的 camelCase 字段）+ `types.ts` 补 `ToolGovernanceConfig` 类型/`tool_config` 字段澄清 CC-10 二义性。
- `sillyhub-daemon/src/interactive/session-manager.ts`：`_buildDriverOptions` 在 canUseTool 最外层包白名单拒绝 gate（toolName 不在 allowedTools → deny，先于写守卫/默认批准；absent 不包，零回归）。

**实测验证（修复后）**：
- read_only worker 执行写文件目标：**文件未创建**（ls 不存在），Write 被 gate 拒（claude THINKING 报错 `tool 'Write' not in allowed_tools whitelist [Read,Glob,Grep]`）。✅
- read_only worker 执行只读目标（Glob+Read 总结）：**正常完成**，只用 Read/Glob/Grep（无过度限制）。✅
- 代码：daemon `tsc` 干净；context.py `ruff` clean；context.py 改动对 test_lease_service 的 1 个隔离失败为**预存债**（git stash 验证：无改动同样失败，`no such table: llm_providers` 单文件隔离问题，全量跑通过）。

**结论**：G3 / D-005@v2（read_only 物制）**经真实 daemon+claude 端到端验证生效**（推翻先前"环境阻塞、机制覆盖"的判断）。

## 5. verify 总评

- **核心新功能（对外 MCP server：鉴权 / scope / 8 tool / FR-04 / webhook 机制）端到端验证通过**（② 完全 + ③ 机制）。
- **代码级全绿**（pytest 72+739+16 / ruff / alembic 可逆）。
- **E2E ① 补跑发现 read_only 物制缺陷 → 本变更内 3 层全部修复 → 真实 daemon+claude 端到端验证物制生效**（read_only worker 写文件被拒、只读任务正常）。G3/D-005@v2 成立。
- 本变更**可验收进 archive**。

## 6. 遗留 / 后续

- **sillyspec 工具缺陷**：apply glob manifest/patch 口径不一致（`docs/sillyspec/apply-glob-manifest-passes-check-but-not-patch.md`）——本 verify 踩到（7 测试文件静默丢失，从 tag 恢复）。
- **环境配置债（非本变更）**：`backend/.env` 的 `SILLYSPEC_MASTER_KEY` 畸形（31 字节），真 key 在 `deploy/.env`；crypto.py 读 os.environ 不读 Settings，host 跑 backend 需显式 export。
- **测试隔离预存债（非本变更）**：`test_lease_service.py::test_interactive_spec_root_from_meta` 单文件跑缺 llm_providers 表失败（全量通过）；git stash 验证非本次 context.py 改动引入。
- **commit 策略**：apply 产出 + read_only 修复（context.py/daemon.ts/session-manager.ts/types.ts）未提交；用户选"压成几个 commit"；tag `pre-apply-2026-08-06-public-mcp-server` 保留。
- **read_only 修复的回归测试**：本次为端到端实测验证；建议补 daemon 单测覆盖 `_buildDriverOptions` 白名单 gate（read_only deny 非白名单 tool）+ `build_claim_payload` interactive 透传 tool_config，防回归。
- **E2E 临时产物**（待清理）：e2e token/webhook/daemon API key（DB dev 数据，规则11 可留）；workspace_member_runtimes 临时 rebind（建议还原 68c63051）；运行的 daemon/backend(8000)/webhook receiver(9999)；`backend/e2e_*.py` 脚本 + cs/SillyHub worktrees。
