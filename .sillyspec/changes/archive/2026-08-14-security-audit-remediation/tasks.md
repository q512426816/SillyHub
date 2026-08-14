---
author: qinyi
created_at: 2026-08-15 00:33:00
---

# 任务（Tasks）— security-audit-remediation

> 编号以 plan.md 为权威（execute 按此解析）；本文件已与 plan.md 对齐（2026-08-15 plan 审查后）。

- task-01 W1 daemon WS 升级期鉴权（backend router + 失败测试）
- task-02 W1 daemon ws-client.ts 传 X-API-Key header（与 task-01 同窗口）
- task-03 W1 claim/pending-leases/heartbeat 归属校验 + compare_digest（含既有 WS 测试 fixture 补凭据）
- task-04 W1 llm-proxy 透传端点（Bearer→ApiKey 分流 + model 归属断言）+ context.py 两处移除 master key + injector/spawn-env 改造（依赖 task-01）
- task-05 W2 file 模块 IDOR 修复（service 归属断言 RBAC 口径 + list 可见域；改造 test_list_without_filters_returns_all_active）
- task-06 W3 platform_sync 收紧（JWT/shk_live_ 写 403、读并集聚合，含 approval 端点；改造 test_post_jwt_auth_ok）
- task-07 W4 sync_documents relative_to + filename 白名单
- task-08 W4 quick-chat 归属过滤（lease metadata.actor_user_id + placement 补写）
- task-09 W4 mission SSE workspace-scoped + workspace activate/init 收紧
- task-10 W4 git_identity schema 校验 + exec_env 防御性拒换行
- task-11 已并入 task-03（compare_digest）；execute 跳过
- task-12 W5 auth_deps query 回退删除 + 前端 5 处 SSE 改造（fetch-SSE / header 转传；双端同窗口）
- task-13 W5 markdown rehype-sanitize + @uiw 引用点排查
- task-14 W5 deploy compose 弱口令 fail-fast + 端口收紧 + 全量回归收尾
