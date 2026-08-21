---
schema_version: 1
doc_type: module-card
module_id: cleanup
author: qinyi
created_at: 2026-08-21 00:00:00
---

# 本地缓存清理（cleanup）

## 定位
daemon 本地缓存清理逻辑（`src/cleanup.ts`）。按黑名单删除 `~/.sillyhub/daemon/` 下
可重建的缓存，供两路调用：CLI `sillyhub-daemon clean [--dry]`（cli.ts `cleanAction`）
与 WS `daemon:cleanup` 指令（daemon.ts MSG.CLEANUP handler，backend machines/{id}/cleanup
端点下发，fire-and-forget）。纯 fs 操作无网络依赖。

## 契约摘要
- `performCleanup(baseDir, options?: { dryRun?: boolean }): Promise<CleanupResult>`——
  `dryRun=true` 仅统计不删除。返回 `{ entries, totalFreedBytes, dryRun }`。
- `CleanupEntry`：`{ path, freedBytes }`——`path` 为目标描述（目录条目是相对路径，
  bin/ 根目录文件类条目是汇总描述如 `bin/*.bak* (3 个文件)`）。
- 清理目标（`CLEANABLE_DIRS` 黑名单 + 文件规则）：
  - 整目录：`specs/`、`claude-config/projects/`（Claude 会话转录）、
    `claude-config/backups/`、`manifests/`、`skills/`（平台 skills 同步缓存，含
    manifest.json 版本记录，删除后触发全量重同步）。
  - `bin/*.bak*` 自更新备份；根目录 `*.log` / `*.out` / `*.err` / `config*.json.bak*`。
- **绝不清理**：`outbox/`（ResilienceService 断线补发队列，删=丢未投递消息）、
  `runs/`（活跃任务终端日志，terminal-observer 另有 7 天保留期清理）、`config.json`、
  `locks/`、`workspaces/`、`claude-config/.claude.json` 活跃配置、`bin/` 非 .bak 文件。

## 关键逻辑
```
performCleanup:
  1. 逐 CLEANABLE_DIRS：dirSize 统计 → 非 dryRun 则 rm(recursive, force)
  2. bin/ 下 matchesGlob('*.bak*') 文件逐个 stat + 删
  3. 根目录日志/备份 glob 匹配（config.json 显式跳过）
  4. 汇总 entries + totalFreedBytes 返回
```

## 注意事项
- daemon.ts 侧 handler 有两道守卫：交互会话运行中（`_interactiveSessionsByLease`
  非空）跳过防删正被写的 transcript / 正被部署的 skills；in-flight guard 防并发指令
  重复清理。
- `matchesGlob` 是简易实现（仅 `*` 通配，`.` 会被转义），够用勿扩展成正则引擎。
- 前端触发走破坏性确认（runtimes 页 modal.confirm），文案与黑名单范围保持一致。
- 若未来往 CLEANABLE_DIRS 加目录，先确认它不是任何可靠性机制的落盘（outbox 教训）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
