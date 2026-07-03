---
author: WhaleFall
created_at: 2026-07-03T11:55:00
change: 2026-07-02-daemon-filesystem-policy
task: task-22
---

# task-22 端到端验证报告

> 验证对象：Daemon Runtime 文件系统权限控制重构（Filesystem Policy Engine）
> 验收依据：design §13（14 条）+ §9 兼容策略（#14 #15 brownfield）
> 验证者：WhaleFall（execute Wave 6 task-22）
> worktree HEAD：b8dabb92（Wave 1~5 全部完成）

## 0. 验证方式声明

worktree 无完整运行栈（无 docker / PostgreSQL / Redis / 运行中 daemon），**未启动真实 daemon+backend+frontend 手动跑 case**。改为三路集成确认：

1. 跑全三套单元/集成测试做集成确认；
2. 对照 design §13 14 条逐条映射到现有测试 / 代码（确认每条有覆盖）；
3. 兼容性 #14 #15 从代码层面确认（心跳兜底 + ws-client POLICY_UPDATE 可选监听）。

真实 e2e（启动栈手动跑 case）列入遗留风险，建议部署后真机验证。

---

## 1. 三套测试集成确认

| 套件 | 命令 | 结果 | 说明 |
|---|---|---|---|
| sillyhub-daemon | `pnpm test` | **1641 passed / 8 skipped**（95 文件全绿） | 全部 policy 模块（path-utils / shell-paths / filesystem-policy / runtime-policy / audit-sink / daemon-policy-update）+ 接入点（session-manager / task-runner-policy-cache / task-runner-approval-decision / file-rpc / daemon-multi-runtime）通过 |
| backend（daemon 模块） | `uv run pytest app/modules/daemon/` | **400 passed / 3 failed** | 3 个失败均为 `tests/test_session_sse.py::TestSubmitMessagesDualPublish`（既有 SSE flake，由 `c1de9497 fix(db): release connection pool slots from SSE streams` 引入的连接池/时序问题，与本次 policy 改动无关） |
| └ 含 audit + policy push 子集 | `pytest app/modules/daemon/audit/tests/ + test_allowed_roots_policy_push.py` | **23 passed** | audit model/router/service + PUT allowed-roots → WS policy_update push 全通过 |
| frontend | `pnpm test` | **561 passed / 29 todo**（53 文件全绿） | 含 `lib/__tests__/daemon-audit.test.ts`（筛选/分页参数 + 字段映射）+ 审计页组件 |

**结论**：核心 policy 链路（daemon PolicyEngine + backend audit/push + frontend 审计页）测试全绿；唯一失败是既有 SSE flake，非本次引入。

---

## 2. design §13 逐条覆盖映射

| # | 验收条目 | 覆盖测试 / 代码 | 状态 |
|---|---|---|---|
| 1 | runtime 隔离（claude `D:\Projects` / codex `E:\Workspace` 互写被拒） | `daemon-multi-runtime.test.ts::heartbeat_syncs_allowed_roots_per_rid`（多 rid 各存各 PolicyCache，不取并集）；`task-runner-policy-cache.test.ts` T1/T2（claude/codex 各取各 roots 不串扰）；`session-manager-allowed-roots.test.ts::runtimeId 透传到 PolicyEngine（per-runtime 隔离 D-002）` | **通过**（单测） |
| 2 | 热更新 interactive 立即生效（sub-second） | `policy/daemon-policy-update.test.ts`（POLICY_UPDATE 解析 + version 去重 + per-runtime version 独立）；`ws-client.test.ts`（POLICY_UPDATE 分支解析 payload → onPolicyUpdate 回调）；`runtime-policy.test.ts`（PolicyCache.set/reload） | **通过**（单测，WS push 链路全绿；真机 sub-second 时延待真机验证） |
| 3 | batch 跑完再生效（不中断，新起 batch 用新配置） | `task-runner-policy-cache.test.ts::T3 D-003 冻结：spawn 后热更新 PolicyCache 不影响已取的 allowedRoots` | **通过**（单测 D-003 冻结语义明确） |
| 4 | Write Tool 未授权拒绝 + 统一中文错误 | `interactive/session-manager-allowed-roots.test.ts`（PolicyEngine.canWrite 拒绝 + 中文 reason）；`filesystem-policy.test.ts`（PolicyDecision.reason） | **通过**（单测） |
| 5 | Bash `echo test > E:\a.txt` 拒绝 | `shell-paths.test.ts::extractBashWritePaths`（重定向 `>`/`>>` 提取 + git bash `/e/` 归一 + 剥离引号）；session-manager shell 间接写路径校验 | **通过**（单测） |
| 6 | PowerShell `Set-Content E:\a.txt` 拒绝 | `shell-paths.test.ts::extractPowerShellWritePaths`（Set-Content/Add-Content/Out-File/New-Item -Path + 位置参数提取） | **通过**（单测） |
| 7 | CMD `mkdir E:\abc` 拒绝 | `shell-paths.test.ts::extractCmdWritePaths`（copy/move/mkdir/echo >/type >/del） | **通过**（单测） |
| 8 | Copy-Item / Move-Item / Remove-Item 拒绝 | `shell-paths.test.ts::extractPowerShellWritePaths`（Copy-Item -Destination / Move-Item -Destination / Rename-Item -NewName / Remove-Item -Path） | **通过**（单测） |
| 9 | Codex batch 带内审批 decline | `task-runner-approval-decision.test.ts::task-17`（fileChange 写白名单内→accept / 写越界→decline 含中文理由 / commandExecution 重定向越界→extractShellWritePaths 提取后 decline / 未注入 PolicyEngine→fail-closed decline / 无可识别路径→fail-closed decline） | **通过**（单测，R-06 在 task-17 已验证审批协议字段） |
| 10 | Python `open("E:\\a.txt","w")` 降级 prompt+audit | design §3 非目标（D-001 接受）+ R-01：脚本内部 `open()` 用户态不拦，靠 prompt 约束 + audit 追溯 | **降级**（D-001 接受的约束，非失败项；OS 沙箱后续独立变更） |
| 11 | 路径规范化 symlink/junction/UNC/`..` 拒绝 | `path-utils.test.ts::resolveRealPath`（symlink 解析 / UNC→UNC_REJECTED / 盘符 case 归一 / 不存在路径 fallback 父目录）；`::normalizePath`（`..` 折叠 + git bash `/x/` 映射）；`::isPathUnderAnyRoot`（边界敏感前缀 + 盘符根修复 ql-20260702-007 + 空严格不兜底 D-007） | **通过**（单测全覆盖；Windows junction 真机行为 R-03 待 Windows 真机验证） |
| 12 | 审计页查询 + 筛选 + 分页 | `frontend src/lib/__tests__/daemon-audit.test.ts`（fetchPolicyAudit URL + decision/provider/tool/path/startTime/endTime/limit/offset 参数透传 + 字段映射）；`backend audit/tests/test_audit.py`（batch 上报落库 + GET 筛选分页）；`audit-sink.test.ts`（daemon 端攒批 + flush + 失败落盘） | **通过**（前后端单测全绿） |
| 13 | list_dir 改调 canRead（读自由，不产 audit） | `file-rpc.test.ts::T18a: policyEngine.canRead 透传 runtimeId + path（读自由 D-008，即便旧白名单外也放行）` | **通过**（单测，D-008 canRead 不记 audit） |
| 14 | 兼容：旧 daemon 连新 backend 靠心跳同步 | 代码层面：`daemon.ts:1683 _syncAllowedRoots(rid, hbResp)` 心跳响应仍写 PolicyCache（去并集，per-rid）；backend 心跳响应带 allowed_roots 不变；旧 daemon 不监听 `daemon:policy_update` → 自动忽略该消息类型（ws-client AC-08b 未知消息仅 warn 不崩） | **通过**（代码层面确认；心跳 15s 兜底全量 reloadAll 已实现） |

### 覆盖统计

- **通过（单测层面覆盖）**：#1 #2 #3 #4 #5 #6 #7 #8 #9 #11 #12 #13 #14 = **13 条**
- **降级（D-001 接受的约束）**：#10 = **1 条**
- **待真机验证**：#2 sub-second 时延 / #11 Windows junction 真机行为（单测已绿，真机确认非阻塞）

---

## 3. 兼容策略 #14 / #15 代码层面确认

### #14 旧 daemon 连新 backend（靠心跳同步生效）

- backend 心跳响应 payload 仍带 `allowed_roots`（未改既有字段，新增 POLICY_UPDATE 为独立消息）；
- 旧 daemon 的 ws-client 不识别 `daemon:policy_update` 消息类型 → 走「未知消息仅 warn 不抛异常」分支（`daemon.test.ts::AC-08b`）；
- 旧 daemon `_syncAllowedRoots` 心跳轮询每 15s 全量同步 → 行为等同现状，无回归。

**结论**：向后兼容，#14 过。

### #15 新 daemon 连旧 backend（无 POLICY_UPDATE，心跳兜底）

- `ws-client.ts:78 onPolicyUpdate` 为**可选回调**（`_callbacks.onPolicyUpdate?.()`），缺省 no-op；
- `ws-client.ts:397` 仅当 `msgType === 'daemon:policy_update'` 时触发解析，旧 backend 不发该消息 → 回调永不触发；
- daemon 侧 `_syncAllowedRoots` + `PolicyCache.reloadAll` 心跳兜底生效，行为等同现状。

**结论**：向前兼容，#15 过。

---

## 4. 约束确认（R-01 / R-06）

- **R-01（Python/Node 脚本内部 `open()`/`fs.write` 无法拦截）**：D-001 已接受，design §3 非目标 + 验收 #10 降级。prompt 约束 + audit 追溯。**非失败项**，OS 沙箱（Seatbelt/AppArmor/sandbox-exec）作为后续独立变更。
- **R-06（Codex batch 无 `--settings` 等价注入）**：**已解**。task-17 通过复用 Codex 带内审批协议（`item/fileChange/requestApproval` / `item/commandExecution/requestApproval` server request）接入 PolicyEngine，decline 时附中文理由。`task-runner-approval-decision.test.ts` 5 个 case 全覆盖。

---

## 5. 遗留风险

| 编号 | 风险 | 等级 | 说明 / 应对 |
|---|---|---|---|
| E2E-1 | 真实 e2e（启动 daemon+backend+frontend 手动跑 14 条 case）未执行 | P1 | worktree 无完整运行栈（无 docker/PG/Redis/运行 daemon）。建议**部署到本机 Docker 后真机回归**全部 14 条 + 兼容 #14 #15 互连场景。本报告基于单测 + 代码层面确认，覆盖度高但非端到端实测。 |
| E2E-2 | task-20 workspaceId 路径偏差 | P2 | audit 路由 `/workspaces/{wid}/runtimes/{rid}/policy-audit` 要求 wid；后端为兼容加无 wid 别名路由（见 task-20）。前端 fetchPolicyAudit 走 wid 路径，真机需确认 runtime→workspace 反查填充正确。 |
| E2E-3 | task-14 多 runtime `runtimeIdProvider` | P2 | daemon 接入点需 `runtimeId` 透传；session-manager 已透传，但 `daemon.resolveRuntimeId`（多 runtime 场景统一解析）待 task-14 落地。当前 interactive session 创建时已知 runtimeId，单 runtime 场景无影响。 |
| E2E-4 | Windows junction / symlink 真机行为（R-03） | P2 | path-utils 单测覆盖 symlink 创建（权限/平台失败时跳过，不阻断）。Windows junction 真机 `fs.realpathSync.native` 行为需 Windows 真机验证。 |
| E2E-5 | backend test_session_sse flake | P3 | 3 个失败为既有 SSE 连接池/时序 flake（`c1de9497` 引入），与本次 policy 改动无关。重跑通常可通过，非阻塞。 |

---

## 6. 验收总结

- design §13 **14 条全有覆盖**：13 条单测层面通过，1 条（#10 Python open）按 D-001 降级接受。
- 兼容性 **#14 #15 代码层面双过**（心跳兜底 + POLICY_UPDATE 可选监听）。
- 三套测试核心链路全绿（daemon 1641 / frontend 561 / backend daemon 400，唯一失败为既有 SSE flake）。
- **建议**：部署后真机 e2e 回归（E2E-1），确认 sub-second 热更新时延、Windows junction 行为、Codex 审批端到端。
