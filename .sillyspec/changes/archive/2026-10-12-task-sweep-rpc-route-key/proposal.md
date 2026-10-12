---
author: flow-machine-draft
created_at: 2026-10-12T00:20:58.110Z
---
# 提案书（Proposal）— 2026-10-12-task-sweep-rpc-route-key

## 动机

任务原话转写：动机：24h 风险审查 P1——sweep_confirmed_dead_tasks（backend/app/modules/daemon/agent_task_store.py:122）把 AgentSession.runtime_id 直接当 hub.send_rpc 路由键，而 WS Hub 连接表按 daemon_instance_id 注册（gateway_misc.py 握手 daemon_local_id、ws_hub.py:106 self._connections[daemon_id]=ws），两个 UUID 空间不同——确认 RPC 在现网恒 is_connected 失败被按「离线」跳过，「问 daemon 注册表才收口」整条链路不可达；仓库既有帮手 session/service/helpers.py:133 _resolve_daemon_id_for_runtime 与 router/daemon_rpc.py:79 都先做映射，唯独本处漏了。叠加启动清扫在 lifespan 阶段同步执行（main.py:154 → agent/service.py:1450），此刻 hub 必无连接，确认分支启动期也必然落空。测试没拦住是因为夹具 _create_runtime 未设 daemon_instance_id（恰好走 legacy 回退路由键=runtime_id）且 _StubHub 按错误键收调用。
成功标准：
- sweep_confirmed_dead_tasks 对每个候选 runtime 先经 _resolve_daemon_id_for_runtime 映射出 daemon 路由键再发 session_live_tasks RPC；runtime 行缺失时该 runtime 的候选跳过（fail-open 保活）；daemon_instance_id 为 NULL（D-007 迁移窗）沿用 helper 既有语义回落 runtime_id 作路由键
- 新增用例：runtime 绑定 daemon_instance_id 后 send_rpc 收到的路由键为 daemon_instance_id 而非 runtime_id（先红后绿）；既有清扫用例语义不变全绿
- 启动清扫从 lifespan 同步 await 改为延迟后台任务（对齐 _recheck_stale_runs_loop 模式：独立 session、强引用防 GC、done 回收异常），给 daemon 留重连窗口后再确认，异常不阻断启动
- 仅跑本改动相关测试（规则 0）：test_agent_session_tasks.py 全文件

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. sweep_confirmed_dead_tasks 对每个候选 runtime 先经 _resolve_daemon_id_for_runtime 映射出 daemon 路由键再发 session_live_tasks RPC；runtime 行缺失时该 runtime 的候选跳过（fail-open 保活）；daemon_instance_id 为 NULL（D-007 迁移窗）沿用 helper 既有语义回落 runtime_id 作路由键
2. 新增用例：runtime 绑定 daemon_instance_id 后 send_rpc 收到的路由键为 daemon_instance_id 而非 runtime_id（先红后绿）；既有清扫用例语义不变全绿
3. 启动清扫从 lifespan 同步 await 改为延迟后台任务（对齐 _recheck_stale_runs_loop 模式：独立 session、强引用防 GC、done 回收异常），给 daemon 留重连窗口后再确认，异常不阻断启动
4. 仅跑本改动相关测试（规则 0）：test_agent_session_tasks.py 全文件

## 成功标准（可验证）

1. sweep_confirmed_dead_tasks 对每个候选 runtime 先经 _resolve_daemon_id_for_runtime 映射出 daemon 路由键再发 session_live_tasks RPC；runtime 行缺失时该 runtime 的候选跳过（fail-open 保活）；daemon_instance_id 为 NULL（D-007 迁移窗）沿用 helper 既有语义回落 runtime_id 作路由键
2. 新增用例：runtime 绑定 daemon_instance_id 后 send_rpc 收到的路由键为 daemon_instance_id 而非 runtime_id（先红后绿）；既有清扫用例语义不变全绿
3. 启动清扫从 lifespan 同步 await 改为延迟后台任务（对齐 _recheck_stale_runs_loop 模式：独立 session、强引用防 GC、done 回收异常），给 daemon 留重连窗口后再确认，异常不阻断启动
4. 仅跑本改动相关测试（规则 0）：test_agent_session_tasks.py 全文件
