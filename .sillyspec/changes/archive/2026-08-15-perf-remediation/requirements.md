---
author: qinyi
created_at: 2026-08-15 06:11:00
---

# 需求（Requirements）— perf-remediation

## 功能需求

- FR-01 reparse（change+scan_docs）同步 FS IO 包 asyncio.to_thread，解析期间事件循环可服务并发请求。
- FR-02 _write_spec_root per-file read_bytes/sha256/move 移出事件循环；change_writer 写文件 to_thread 补漏。
- FR-03 _bump_files_processed 批量回写（≤50 文件或 ≤500ms 一次 UPDATE），终态准确。
- FR-04 apply_ops 循环前 IN 预取 SpecFileManifest，消除 per-op SELECT。
- FR-05 scan_docs list_ 无 q 时排除 content 列；有 q 时保留 SQL LIKE（不劣于现状）。
- FR-06 api_key 认证候选查询按 key_prefix 索引过滤；无 prefix 历史行回退全扫。
- FR-07 _list_files_sync 改 os.scandir 单遍（消除双 stat）。
- FR-08 scan_docs parser 每文件 stat 收敛 1 次；_safe_mtime 推广三处裸 fromtimestamp。
- FR-09 _load_module_map 按 (path, mtime) 复合键进程级缓存（值不可变幂等填充）；platform_managed 路径探测附带修复。
- FR-10 后端 GET logs 增加可选 after 游标（timestamp 语义）；前端轮询传 after 增量合并（id 去重），空结果 fallback 全量。
- FR-11 daemon _pollLoop 按通道拆分：lease 分支 WS 健康（isConnected 且 <90s 有消息）跳过、断连恢复；change-write 分支保留 30s 不变（无 WS 推送通道）。
- FR-12 daemon 落盘日志（terminal.log/audit jsonl）启动清理 N 天前文件。

## 非功能需求

- NFR-01 行为零变更：对外响应结构/状态机/日志格式不变；业务断言不动。
- NFR-02 每项修复先写行为保持测试（等价性）再改实现。
- NFR-03 Windows/Linux/macOS 兼容（stat/scandir 跨平台语义）。
- NFR-04 不动 DB schema、不加迁移、不加新依赖。
