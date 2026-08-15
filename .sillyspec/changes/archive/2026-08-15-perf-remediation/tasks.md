---
author: qinyi
created_at: 2026-08-15 06:12:00
---

# 任务（Tasks）— perf-remediation

- task-01 W1 reparse to_thread（change:1075 + scan_docs:172 + _resync_change_docs 顺手）
- task-02 W1 _write_spec_root 循环入线程 + change_writer to_thread 补漏
- task-03 W1 _bump_files_processed 批量回写 + apply_ops IN 预取
- task-04 W2 scan_docs list 排除 content + 搜索等价性
- task-05 W2 api_key key_prefix 过滤
- task-06 W2 _list_files_sync scandir + scan_docs parser stat 复用 + _safe_mtime 推广
- task-07 W2 _load_module_map mtime 缓存
- task-08 W3 日志增量游标（后端 agent/router+service 加 after 参数 + 前端 mission-console 增量合并）
- task-09 W3 daemon _pollLoop 按通道拆分门控（lease 门控 / change-write 不动）+ 日志清理（terminal-observer + audit-sink）
- task-10 收尾：三端回归 + 慢请求日志观测对比
