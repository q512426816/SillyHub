---
author: WhaleFall
created_at: 2026-07-02T15:02:00
change: 2026-07-02-daemon-filesystem-policy
---

# Tasks: Daemon Filesystem Policy Engine

> 待 plan 阶段按 Wave 展开（依赖关系 + 实现顺序）。方向与文件清单见 `design.md` §5-§6。

## 预估任务方向（plan 细化）

### daemon Policy 模块（新增）
- [ ] `policy/path-utils.ts`：normalizePath + resolveRealPath（realpath + 父目录 fallback + 大小写归一 + 拒 UNC）+ isPathUnderAnyRoot + 单测【D-005】
- [ ] `policy/runtime-policy.ts`：RuntimePolicy + PolicyCache（Map<rid,RP>，get/set/reload/reloadAll，不偷偷加 homedir）+ 单测【D-002】【D-007】
- [ ] `policy/filesystem-policy.ts`：PolicyEngine（canRead/canWrite/canCreate/canDelete/canRename，带 runtimeId）+ 单测【D-001】
- [ ] `policy/shell-paths.ts`：Bash + PowerShell + CMD 写路径提取 + 单测【FR-04】
- [ ] `policy/audit-sink.ts`：AuditSink 攒批 + flush + 限流 + 失败落盘 + 单测【D-006】【D-008】

### daemon 各 Tool 接入点改造
- [ ] interactive：`session-manager.ts` `_wrapWithWriteGuard` 改调 PolicyEngine（带 runtimeId）+ 删除 `write-guard.ts`【D-002】
- [ ] batch Claude：`task-runner.ts` + `stream-json.ts` + `permission-rules.ts` 改用 PolicyCache.get(rid) 快照生成 CC settings【FR-07】
- [ ] batch Codex：`json-rpc.ts` + `task-runner.ts` 接入带内审批协议，移除自动 accept，PolicyEngine 决策 accept/decline【R-06】
- [ ] file-rpc：list_dir 改调 PolicyEngine.canRead【FR-09】
- [ ] 热更新：`ws-client.ts` 监听 POLICY_UPDATE + `daemon.ts` `_syncAllowedRoots` 改写 PolicyCache（去并集）+ 心跳兜底 + `cli.ts` 构造注入【D-004】

### backend 侧
- [ ] `protocol.py` + `ws_hub.py`：新增 POLICY_UPDATE 消息 + send_policy_update【D-004】
- [ ] `router.py`：PATCH allowed-roots 端点改完 DB 后触发 ws_hub push
- [ ] `daemon/audit/`：PolicyAuditLog model + service + router（POST /daemon/audit/batch + GET 审计查询）+ 测试【D-006】
- [ ] migration：新建 policy_audit_log 表【FR-14】

### frontend 侧
- [ ] `lib/daemon-audit.ts`：审计 API client
- [ ] `runtimes/[id]/audit/page.tsx`：审计页（统计 + 筛选 + 列表 + 分页）【D-006】
- [ ] `runtimes/page.tsx`：runtime 卡片加「审计日志」入口

### 验证
- [ ] runtime 隔离（claude/codex 各看各的 roots）
- [ ] 热更新（interactive 立即 / batch 跑完再生效 / 新起 batch 用新配置）
- [ ] 各 Tool 拦截（Write/Bash/PowerShell/CMD/Copy/Move/Delete）
- [ ] Codex batch 带内审批 decline
- [ ] 路径规范化（symlink/junction/UNC/`..`）
- [ ] 审计页查询 + 筛选 + 分页
- [ ] 兼容（旧 daemon 连新 backend 靠心跳 + 新 daemon 连旧 backend）
