---
author: flow-machine-draft
created_at: 2026-10-12T00:20:58.111Z
---
# 任务注册表（Tasks）— 2026-10-12-task-sweep-rpc-route-key

- [x] task-01: sweep_confirmed_dead_tasks 对每个候选 runtime 先经 _resolve_daemon_id_for_runtime 映射出 daemon 路由键再发 session_live_tasks RPC；runtime 行缺失时该 runtime 的候选跳过（fail-open 保活）；daemon_instance_id 为 NULL（D-007 迁移窗）沿用 helper 既有语义回落 runtime_id 作路由键
- [x] task-02: 新增用例：runtime 绑定 daemon_instance_id 后 send_rpc 收到的路由键为 daemon_instance_id 而非 runtime_id（先红后绿）；既有清扫用例语义不变全绿
- [x] task-03: 启动清扫从 lifespan 同步 await 改为延迟后台任务（对齐 _recheck_stale_runs_loop 模式：独立 session、强引用防 GC、done 回收异常），给 daemon 留重连窗口后再确认，异常不阻断启动
- [x] task-04: 仅跑本改动相关测试（规则 0）：test_agent_session_tasks.py 全文件
