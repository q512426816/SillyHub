---
author: qinyi
created_at: 2026-08-15 07:10:00
---

# 模块影响分析（Module Impact）— perf-remediation 性能审查高危修复

## 变更：perf-remediation

> 性能优化（行为零变更）。基于 design.md 文件变更清单 + plan.md 5 Wave 分析；module-map 参照 .sillyspec/docs/SillyHub/modules/_module-map.yaml。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| change | 逻辑变更 | backend/app/modules/change/service.py | reparse/_resync to_thread；_list_files_sync scandir 单遍；_safe_mtime 推广 |
| change | 逻辑变更 | backend/app/modules/change/parser.py | _load_module_map (path,mtime) 复合键缓存 + platform_managed 路径探测修复 |
| scan_docs | 逻辑变更 | backend/app/modules/scan_docs/service.py | reparse to_thread；list_ 无 q 时排除 content 列 |
| scan_docs | 逻辑变更 | backend/app/modules/scan_docs/parser.py | 每文件 stat 收敛 1 次 + _safe_mtime 推广 |
| spec_workspace | 逻辑变更 | backend/app/modules/spec_workspace/service.py | _write_spec_root 循环入线程；_bump_files_processed 批量回写；apply_ops IN 预取；_prune to_thread |
| change_writer | 逻辑变更 | backend/app/modules/change_writer/service.py | write_text/stat to_thread |
| auth | 逻辑变更 | backend/app/modules/auth/api_key_service.py | 认证候选 key_prefix 索引过滤 |
| agent | 接口变更 | backend/app/modules/agent/router.py, service.py | GET logs 增加可选 after 游标参数（行为向后兼容，不传=现状） |
| frontend | 逻辑变更 | frontend/src/lib/agent.ts, components/mission-console.tsx | 日志轮询 after 增量 + id 去重合并 |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/daemon.ts, ws-client.ts | _pollLoop lease 分支门控（isConnected+<90s 消息）；ws-client lastMessageAt getter |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/terminal-observer.ts, policy/audit-sink.ts | 启动清理 7 天前落盘日志 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| （execute 完成后由 archive 阶段同步） | 待办 | pending |
