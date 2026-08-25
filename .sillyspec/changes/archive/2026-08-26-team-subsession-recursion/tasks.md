---
author: qinyi
created_at: 2026-08-26 02:45:00
---

# 任务清单（Tasks）— 团队分身递归开闸 P2

- [x] task-01: 数据模型——tree_depth 列（NOT NULL DEFAULT 0 + 全表 CASE 回填迁移）+ mission_worker_sessions_tree 递归 CTE（model.py）
- [x] task-02: mcp_tools 全量——五端点统一解析（爬根禁懒建）+ 递归派发（parent=调用会话/depth+1/深度门 400/worktree_path 禁透传）+ converge 层 0 收口 403 + worker_done/busy 全树枚举
- [x] task-03: mission.py——虚拟映射增补（budget_force_ended_at 时 ended-未done→failed）+ is_worker_complete/mission_derive_status 分身集合换全树
- [x] task-04: worker_depth 透传链 + 会话闸——placement 写 metadata → context.py 白名单 → daemon.ts 归一化 → types.ts 四处类型 → session-store-persistence 保档 → session-manager 消费分层 + 会话总数闸（env 默认 20）
- [x] task-05: daemon 分层工具集——mcp-server.ts 非叶 5 件/叶 1 件两档硬编码 + mcp-config/cli.ts 谓词分层 + 旧 lease 无键叶档兜底
- [x] task-06: run_sync 失败即收口——首 run failed + 会话从未 ready + parent 非空 → 子会话置 failed+ended_at
- [x] task-07: patrol 职责⑥预算强收——budget_force_ended_at 原子标记 + 批量收口 + 计数键 + 孤儿/收口枚举换全树
- [x] task-08: 全树换点其余 + 非叶简报——control 三口径 / finalizer cleanup 与收口遍历 / mission_context workers_all_terminal_with_stats+简报 / daemon-router 摘要含孙折叠计数
- [x] task-09: 测试补全（深度门/层0收口/全树/预算强收/会话闸/分层注入）+ 三端全量回归
