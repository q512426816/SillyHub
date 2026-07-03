---
author: WhaleFall
created_at: 2026-07-02T15:02:00
change: 2026-07-02-daemon-filesystem-policy
---

# Requirements: Daemon Filesystem Policy Engine

## 功能需求

### daemon 侧 — Policy 模块
- **FR-01**：新增 `sillyhub-daemon/src/policy/path-utils.ts`——`normalizePath`（strip 引号 + git bash `/x/`→`X:/` + pathResolve 折叠 `..`）+ `resolveRealPath`（存在则 `fs.realpathSync.native` 解析 symlink/junction；不存在则 realpath 父目录 + 拼文件名；Windows 大小写归一；拒 UNC）+ `isPathUnderAnyRoot`（边界敏感前缀比较，沿用 ql-20260702-007 盘符根修复）。【D-005】
- **FR-02**：新增 `sillyhub-daemon/src/policy/runtime-policy.ts`——`RuntimePolicy { allowedRoots, version }` + `PolicyCache`（`Map<runtime_id, RuntimePolicy>`，get/set/reload/reloadAll），**替代 `daemon.ts:1682` 并集逻辑**，每 runtime 独立。【D-002】【D-007】
- **FR-03**：新增 `sillyhub-daemon/src/policy/filesystem-policy.ts`——`PolicyEngine.canRead/canWrite/canCreate/canDelete/canRename(runtimeId, path) → PolicyDecision { allowed, reason, normalizedPath }`；内部走 path-utils 规范化 + PolicyCache.get(rid) + isPathUnderAnyRoot；canRead 默认全 allow。【D-001】
- **FR-04**：新增 `sillyhub-daemon/src/policy/shell-paths.ts`——Bash（`>/>>/cp/mv/install/tee/mkdir/touch`）+ PowerShell（`Set-Content/Add-Content/Out-File/New-Item/Copy-Item/Move-Item/Rename-Item/Remove-Item`）+ CMD（`copy/move/mkdir/echo >/type >/del`）写路径提取，返回 `string[]` 交 PolicyEngine 逐条 canWrite。
- **FR-05**：新增 `sillyhub-daemon/src/policy/audit-sink.ts`——`AuditSink.record(AuditEvent)` 攒批（100 条 / 5s）+ `flush` POST `/daemon/audit/batch` + 失败重试指数退避 + 连续失败降级落盘 `~/.sillyhub/daemon/audit-failed.jsonl`。【D-006】【D-008】
- **FR-06**：删除 `sillyhub-daemon/src/interactive/write-guard.ts`，逻辑迁入 PolicyEngine；`session-manager.ts:822` `_wrapWithWriteGuard` 改调 `PolicyEngine.canWrite(session.runtimeId, path)`。【D-002】
- **FR-07**：`task-runner.ts:454` + `stream-json.ts:307` + `permission-rules.ts` batch spawn Claude 改用 `PolicyCache.get(task.runtimeId)` 快照生成 CC `--settings` permission rules。
- **FR-08**：`json-rpc.ts:128` + `task-runner.ts` Codex batch 接入带内审批协议——移除 `APPROVAL_RESPONSES`（`json-rpc.ts:49`）自动 accept，改为处理 `item/fileChange/requestApproval` / `item/commandExecution/requestApproval` server request，由 PolicyEngine 决策 accept/decline（decline 附中文理由）。【R-06 已解】
- **FR-09**：`file-rpc.ts` / `daemon.ts:1878` list_dir 改调 `PolicyEngine.canRead(rpc.runtimeId, path)`，行为不变（读自由）。
- **FR-10**：`ws-client.ts` 监听 `POLICY_UPDATE` 消息 → `PolicyCache.set(rid, roots)`；`daemon.ts` `_syncAllowedRoots` 改写 PolicyCache（去并集）+ 心跳兜底 reloadAll；`cli.ts` 构造 PolicyEngine/AuditSink/PolicyCache 注入 Daemon。【D-002】【D-004】

### backend 侧
- **FR-11**：`daemon/protocol.py` 新增 `POLICY_UPDATE` 消息类型 + `PolicyUpdatePayload { runtime_id, allowed_roots, version }`。【D-004】
- **FR-12**：`daemon/ws_hub.py` 新增 `send_policy_update(rid, roots)`；`daemon/router.py` PATCH `/runtimes/{id}/allowed-roots` 端点改完 DB 后触发 ws_hub push。【D-004】
- **FR-13**：新增 `backend/app/modules/daemon/audit/`——`PolicyAuditLog` model（runtime_id/workspace_id/decision/provider/tool/path/reason/created_at + 索引）+ service + router（`POST /daemon/audit/batch` claim_token 鉴权 + `GET /workspaces/{wid}/runtimes/{rid}/policy-audit` 分页筛选）。【D-006】
- **FR-14**：migration 新建 `policy_audit_log` 表。【D-006】
- **FR-15**：**不改** `DaemonRuntime.allowed_roots` 模型（已 per-runtime）。【D-002】

### frontend 侧
- **FR-16**：新增 `frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx` 审计页——统计概览（ALLOW/DENY 计数）+ 筛选（decision/provider/tool/path/时间）+ ALLOW/DENY 记录列表 + 分页。【D-006】
- **FR-17**：新增 `frontend/src/lib/daemon-audit.ts` API client；`runtimes/page.tsx` runtime 卡片加「审计日志」入口。

## 用户场景（Given/When/Then）
- **runtime 隔离**：Given claude runtime 配 `D:\Projects`、codex runtime 配 `E:\Workspace`，When claude session 写 `E:\Workspace`，Then 拒绝（不看 codex roots）；When codex session 写 `D:\Projects`，Then 拒绝。
- **热更新**：Given admin 改某 runtime allowed_roots 保存，When 该 runtime interactive session 下次 tool 调用，Then 立即生效（sub-second，无需重启）。
- **batch 跑完再生效**：Given admin 改 allowed_roots，When 某 batch 任务正在跑，Then 保持旧配置至跑完不中断；When 新起 batch，Then 用新配置。
- **Write 拒绝**：Given runtime allowed_roots 不含 `E:\Temp`，When agent Write `E:\Temp\a.txt`，Then 拒绝 + 统一中文错误提示。
- **Bash 拒绝**：When `echo test > E:\a.txt`，Then 拒绝。
- **PowerShell 拒绝**：When `Set-Content E:\a.txt`，Then 拒绝。
- **Codex batch 拒绝**：When Codex batch 任务写越界，Then 带内审批 decline + 中文理由。
- **路径规范化**：Given symlink 指向越界目录，When agent 经 symlink 写，Then 拒绝；When `..` 穿越，Then 拒绝；When UNC 路径，Then 拒绝。
- **审计**：Given 用户打开某 runtime 审计页，When 查询近 24h DENY，Then 列出所有拒绝记录（agent/tool/path/reason）。
- **Python open 降级**：When agent 跑 `python -c "open('E:\\a.txt','w')"`，Then 不硬拦（D-001 接受），靠 prompt 约束 + audit 可追溯。

## 验收（见 design §13）
1. runtime 隔离生效。2. interactive 热更新立即生效。3. batch 跑完再生效不中断。4. Write 未授权拒绝。5. Bash 重定向拒绝。6. PowerShell Set-Content 拒绝。7. CMD mkdir 拒绝。8. Copy/Move/Delete 拒绝。9. Codex batch 写越界 decline。10. Python open 降级 prompt+audit。11. 路径规范化防 symlink/junction/UNC/`..`。12. 审计页可查+筛选+分页。13. list_dir 行为不变。14. 新旧 daemon/backend 互连兼容。

## 决策引用（D-xxx@vN）
- D-001@v1（务实方案）→ FR-03/FR-04（Tool 层拦截）+ 验收 #10（脚本内部降级）
- D-002@v1（按 runtime 隔离）→ FR-02/FR-06/FR-10 + FR-15（不改模型）
- D-003@v1（batch 跑完再生效）→ FR-07（spawn 快照）+ 验收 #2 #3
- D-004@v1（WS push）→ FR-10/FR-11/FR-12
- D-005@v1（realpath 规范化）→ FR-01 + 验收 #11
- D-006@v1（audit 全量回传）→ FR-05/FR-13/FR-14/FR-16/FR-17
- D-007@v1（homedir 严格按 admin）→ FR-02（PolicyCache 不偷偷加 homedir，新 runtime 默认 [homedir]）
- D-008@v1（canRead 不记 audit）→ FR-05（仅写类记）+ FR-09（canRead 不 audit）

## 剩余风险
- **R-01**（D-001 接受）：Python/Node 脚本内部 `open()`/`fs.write` 不硬拦，靠 prompt + audit 追溯——根本约束，非 blocker。
- **R-06**：Codex batch 接入带内审批协议，execute 阶段需验证 Codex app-server 审批消息字段格式 + decline 响应格式（方案已定，实现细节待验证）。
- **R-03/R-04**：realpath 跨平台行为 + 不存在路径 fallback，单测 + Windows CI 验证。
- **policy_engine_enabled 回退开关**（design §9 自审存疑）：是否需要留 YAGNI，execute 阶段判断。
