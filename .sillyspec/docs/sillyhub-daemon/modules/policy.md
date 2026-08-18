---
schema_version: 1
doc_type: module-card
module_id: policy
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 文件系统安全策略中心（policy）

## 定位
daemon 统一的文件系统安全策略中心（目录 `src/policy/`，5 文件）。所有 agent 的
读/写类工具调用与 shell 命令写路径都经此裁决 + 审计：filesystem-policy 裁决引擎、
runtime-policy 按 runtime_id 隔离的策略缓存、path-utils 路径规范化纯函数、
shell-paths 从命令字符串提取写路径、audit-sink 攒批审计上报。

## 契约摘要
- `PolicyEngine(cache: PolicyCache, auditSink: AuditSink)`：
  - `canRead(runtimeId, path)`——全 allow 且**不记 audit**（读量大，D-008），仍返回 normalizedPath。
  - `canWrite / canCreate / canDelete(runtimeId, path, provider, tool): PolicyDecision`——共用 judgeWrite。
  - `canRename(runtimeId, oldPath, newPath, ...)`——两端各判一次，任一越界 deny，reason 标注 `[源路径]`/`[目标路径]`。
  - `PolicyDecision = { allowed, reason, normalizedPath }`；deny reason 为四行中文文案（Agent/目标路径/原因）。
- `PolicyCache`：`Map<runtime_id, RuntimePolicy>`；`get` 未命中返回 undefined（不 fallback homedir，D-007 留调用方兜底）；`set/reload` 经 `config.normalizeAllowedRoots` 归一（只 resolve 不 realpath，realpath 下放判定层）+ version 单调递增（WS POLICY_UPDATE 去重）；`reloadAll(entries)` 心跳全量重建、version 重置 1。
- `AuditEvent = { decision, runtimeId, provider, tool, path, reason, ts }`（与 backend PolicyAuditLog 字段一一对应）。
- `AuditSink(sender, opts?)`：攒批 → `AuditBatchSender.postBatch`（依赖倒置，
  task-11 装配 HubClient 适配 POST /daemon/audit/batch）；默认参数 maxSize=100 /
  flushIntervalMs=5000 / retryBaseMs=500 / maxRetries=5 / failoverThreshold=3，
  落盘路径默认 `~/.sillyhub/daemon/audit-failed.jsonl`；`nullSender` 空实现
  （未注入上报通道时静默丢，不阻断）。
- deny reason 四行中文模板：`Runtime Policy 拒绝本次写入。/ Agent：<provider> /
  目标路径：<path> / 原因：<cause>`；cause 三种——目标目录未配置为可写目录 /
  UNC 路径不允许写入 / 策略未加载（Runtime Policy 未为此 agent 配置）。
- shell-paths：`extractShellWritePaths(command, kind)` 统一入口（kind: bash/powershell/cmd），各 `extract*WritePaths` 返回 string[]。

## 关键逻辑
```
judgeWrite(runtimeId, path, provider, tool):
  normalizedPath = resolveRealPath(path)          # realpath 防 symlink/junction 绕过
  UNC(\\server\share) → deny(UNC 文案)
  policy = cache.get(runtimeId); 未命中 → deny(策略未加载)   # 不 throw 不兜底
  isPathUnderAnyRoot(normalizedPath, policy.allowedRoots) → allow / deny
  ALLOW 与 DENY 均记 audit（D-006 全量审计）

resolveRealPath: normalizePath(剥引号 + git bash /x/→X:/ + resolve)
  → 存在则 realpathSync.native；不存在逐级向上 realpath 最近祖先再拼回
  → UNC 返回哨兵 UNC_REJECTED；Windows 盘符归一小写

AuditSink flush: buffer 满或定时 → postBatch；失败指数退避(500ms×2^n, 5 次)
  → 连续失败 ≥3 降级 append 落盘 audit-failed.jsonl（防 OOM，buffer 必须能清空）
```

## 注意事项
- 读自由 + 写受限：canRead 是刻意的全 allow（D-008 仅审计写类），别「顺手」加读校验。
- PolicyEngine 不自己 fallback homedir（D-007）：cache 未命中即 deny，兜底语义归
  task-runner/cli 调用方决定（task-16：PolicyCache.get(runtimeId) 未命中回退
  config.allowed_roots）。
- `isPathUnderAnyRoot` 边界细节：root 已含尾 sep（盘符根 `D:\`、Unix `/`）不补 sep，
  否则双分隔符前缀导致永远 false 误 deny（ql-20260702-007）；Windows 比较前双侧小写。
- shell-paths 是尽力而为（D-001）：纯正则覆盖重定向 / cp / mv / install / tee /
  mkdir / touch 及 PowerShell/CMD 常见写模式，不做 shell AST；eval/变量展开提不到
  路径靠 audit 追溯兜底，不抛错。
- audit-sink 启动时清理 failover 目录 mtime 超 7 天的 *.jsonl（perf-remediation
  task-09），全程容错不影响构造；flush 失败永远吞错不阻断 PolicyEngine。
- runtime-policy 依赖 config（normalizeAllowedRoots）；本模块被 cli / daemon /
  task-runner / file-rpc / interactive（session-manager 用 path-utils + shell-paths）消费。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
