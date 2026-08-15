---
author: qinyi
created_at: 2026-08-15 06:55:00
plan_level: full
---

# 实现计划（Plan）— perf-remediation

## 复杂度

plan_level: full（10 task、14+ 文件、跨 backend/daemon/frontend 三子项目）。行为零变更（NFR-01）。W3（前端+daemon）与 W1-W2（backend）文件不重叠可并行。注意共享文件：task-01/02/03 无共享（不同文件）；task-01 含 change/service.py、task-06 也含 change/service.py → 必须分 Wave。

## Wave 1 · 事件循环解放（backend）

- [x] task-01: reparse to_thread。change/service.py:1086（parse_workspace）、:480 附近（_resync_change_docs 内 _parse_change）与 scan_docs/service.py:172-176（parse_docs_tree/parse_component）包 await asyncio.to_thread(...)。行为保持测试：reparse 前后结果等价（既有 reparse 测试作锚点，不改断言）。

## Wave 2 · spec 写入线程化（backend）

- [x] task-02: _write_spec_root 循环入线程 + change_writer to_thread。spec_workspace/service.py:622-702 循环体 FS 操作（read_bytes/sha256/shutil.move）移入 to_thread（与 DB await 交织部分：先线程内算 hash/mtime/落盘，回 loop 批量写库——实现细节按现有 IN 预取结构最小改）；_prune_spec_backups（:897）to_thread；change_writer/service.py:264/:349 write_text+stat to_thread。
## Wave 3 · 批量化（backend，串行于 task-02 后——共享 spec_workspace/service.py；Wave 编号仅分组用）

- [x] task-03: 批量回写 + IN 预取。连带测试债：spec_workspace/tests/test_per_file_progress.py:94 断言 bump 每文件调用一次（call_count==3），批量后按 design 目标 5 授权调整断言（业务语义不变，终态准确）。_bump_files_processed（spec_workspace/service.py:732-754）改内存计数 + 每 50 文件/500ms 单次 UPDATE（files_processed = files_processed + batch）+ finally 终态回写（保留 status=='claimed' 守卫语义）；apply_ops（:965-978 SELECT、:1048-1059 rename 查询）循环前按 path ∪ new_path IN 预取。单测：批量回写终态准确（中途值允许粒度）、apply_ops 语义等价（既有测试锚点）。

## Wave 4 · 查询收窄 + FS 惯性（backend，与 W1-W3 无共享文件）

- [x] task-04: scan_docs list 收窄。service.py:45-72 list_ 无 q 时 load_only 排除 content；有 q 保留 LIKE（现状）。测试：无 q 列表结果等价（含字段完整性——content 本就不在响应 schema）；有 q 行为不变。
- [x] task-05: api_key key_prefix 过滤。api_key_service.py:228-241 候选查询加 WHERE key_prefix = :prefix（prefix=_display_prefix(plaintext)）；结果为空时防御性回退全扫分支（prefix 不匹配但 key 有效的理论场景）。测试：认证命中/未命中行为等价 + prefix 过滤单测（造同 prefix/异 prefix key）。
- [x] task-06: scandir + stat 复用 + _safe_mtime。_safe_mtime 处置收敛为唯一选项：scan_docs 与 change/service 直接 from change.parser import _safe_mtime（不动 change/parser.py 本体，避免与 task-07 同 Wave 共享 parser.py）。change/service.py:267-289 _list_files_sync 改 os.scandir 显式栈（照抄 change/parser.py:496-530）；scan_docs/parser.py:127-186 每文件 stat 收敛 1 次（size+mtime 同一 stat_result）；scan_docs/parser.py:165/:247 与 change/service.py:286 裸 fromtimestamp 改用 _safe_mtime（从 change/parser.py import 或移 app/core/paths.py）。测试：文件列表等价、mtime 脏值防御（year 30828 不炸）。
- [x] task-07: module-map 缓存。change/parser.py:408-465 _load_module_map 模块级缓存（(resolved path, mtime) 复合键，值不可变 dict，幂等填充）；platform_managed 布局路径探测附带修复（root/.sillyspec/docs 与 root/docs 都找）。测试：同 mtime 复用（mock read 计数）、文件变更后失效重读、跨 workspace 不串。

## Wave 5 · 前端 + daemon（与 W1-W4 并行）

- [x] task-08: 日志增量游标。后端 agent/router.py:456-474 GET logs 加可选 after 参数（ISO timestamp）→ agent/service.py:952-981 get_run_logs 加 WHERE timestamp > after（取比游标更新的增量；plan 审查修正了初版 <= 反向错误；沿用 5000 上限）；前端 lib/agent.ts:115 核对 after 类型 + mission-console.tsx:208-223 WorkerLogPanel 轮询传上一批最早一条 timestamp、按 id 去重合并、空结果 fallback 全量重拉一次。测试：后端游标行为单测；前端 vitest 增量合并/去重/fallback。
- [x] task-09: daemon 门控 + 日志清理。daemon.ts:2113-2165 _pollLoop 拆分：lease 分支在 wsClient.isConnected 且距最后 WS 消息 <90s 时跳过该轮（需要 ws-client 暴露 lastMessageAt——查 :207 isConnected 附近加只读 getter）；change-write 分支 30s 不动。terminal-observer.ts:78-94 启动清理 7 天前 runs/<leaseId>/ 目录；policy/audit-sink.ts:174-183 启动清理 7 天前 failover jsonl。测试：vitest 门控条件矩阵（连接+新鲜消息=跳过/断连=执行/消息陈旧=执行）、清理不误删新文件。
- [x] task-10: 收尾回归。backend 命中模块（change/scan_docs/spec_workspace/change_writer/auth/agent）pytest + ruff + mypy；sillyhub-daemon pnpm test + typecheck；frontend pnpm test + tsc。观测对比：dev 环境触发一次 reparse 确认无 slow.request 尖峰（monitoring 三件套，D-003）。

## 依赖关系

- task-02 与 task-03 共享 spec_workspace/service.py → 结构上已拆 Wave 2/Wave 3 两节串行（postcheck 正则只认纯数字编号，Wave 2b 会被归入 Wave 2）。
- task-01（W1）与 task-06（W4）共享 change/service.py → 已分 Wave 串行。task-06 的 _safe_mtime 收敛为 import 不改 parser.py，与 task-07（W4 同 Wave）不共享文件。
- task-01 与 task-06 共享 change/service.py → 分属 W1/W3 串行安全。
- task-08/09/10 与 backend 线文件不重叠可并行。
- 无循环依赖。

## 完成标准（每 task）

行为保持测试先行（优化前后等价）→ 实现绿 → 本模块 pytest 子集绿 → ruff/mypy 过（backend）。

## 测试策略

test_strategy=module；daemon/frontend vitest。观测验证用 monitoring 日志（D-003）。

## 需求与决策覆盖对照

- FR-01→task-01；FR-02→task-02；FR-03→task-03；FR-04→task-03（apply_ops IN 预取同卡）；FR-05→task-04；FR-06→task-05；FR-07→task-06；FR-08→task-06（stat 复用+_safe_mtime 同卡）；FR-09→task-07；FR-10→task-08；FR-11→task-09；FR-12→task-09（terminal-observer+audit-sink 清理同卡）；NFR 验证→task-10。
- D-001@v1（不动 schema）→全部；D-002@v1（to_thread/批量）→task-01~03；D-003@v1（monitoring 观测）→task-10。
