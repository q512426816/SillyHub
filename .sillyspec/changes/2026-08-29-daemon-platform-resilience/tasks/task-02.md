---
id: task-02
title: 'backend-ws-disconnect-delayed-offline-and-placement-liveness-check'
title_zh: 'backend WS 断开 10s 延迟降级 + placement 派发实连接检查'
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/tests/test_ws_disconnect_offline.py
  - backend/app/modules/agent/tests/test_worker_subsession_dispatch.py
  - backend/app/modules/agent/tests/test_subsession_recursion_dispatch.py
  - backend/app/modules/agent/tests/test_integration_cross_workspace.py
  - backend/app/modules/agent/tests/test_mcp_tools_cross_workspace.py
related_tests:
  - path: backend/app/modules/agent/tests/test_worker_subsession_dispatch.py
    reason: placement 实连接过滤使只灌 DB online 的派发用例失效（模拟修复前假在线行为），补 autouse fake hub（is_connected 恒 True）视为实连
  - path: backend/app/modules/agent/tests/test_subsession_recursion_dispatch.py
    reason: 同上（3 用例）
  - path: backend/app/modules/agent/tests/test_integration_cross_workspace.py
    reason: 同上（3 用例，并入既有 autouse 链）
  - path: backend/app/modules/agent/tests/test_mcp_tools_cross_workspace.py
    reason: 同上（2 用例；fake hub 需带 send_rpc 按离线语义抛 DaemonRuntimeOffline 保持真 delegate 用例降级形态）
goal: >
  WS 断开后延迟 10s 再把 instance 与 runtimes 标 offline（DB），延迟任务执行时复查 WS 实连接可取消标记，placement 候选筛选联查实连接，消除网络抖动误离线与派发即卡死。
implementation:
  - ws_hub.disconnect 保留现有内存连接清理与 pending RPC 取消逻辑，新增 10s 延迟任务挂载点（回调携带 daemon_id，ws_hub 不直接依赖 DB 层）
  - runtime/service.py 实现延迟降级逻辑，10s 后把 instance 与其 runtimes 的 DB 状态标 offline
  - 延迟任务执行时复查取消判定，ws_hub.is_connected(daemon_instance_id) 为真则跳过标记（D-007 Grill 裁定）
  - 心跳成功路径维持既有语义，daemon 重连后心跳即把状态恢复 online 覆盖离线标记
  - placement.py 三处候选行查询（约 1586/1622/1661 行的 SELECT，结果已含 daemon_instance_id 列）对每行联查 ws_hub.is_connected(row.daemon_instance_id)，不实连的行跳过不进候选
  - 新增 backend/app/modules/daemon/tests/test_ws_disconnect_offline.py 覆盖重连取消、超时标 offline、心跳恢复 online、placement 跳过不实连候选
acceptance:
  - WS 断开后 10s 内重连（is_connected 为真）时延迟任务取消，instance 与 runtimes 不被标 offline
  - WS 断开超 10s 未恢复时 instance 与其 runtimes 的 DB 状态被标 offline
  - 心跳成功后状态恢复 online，覆盖此前的 offline 标记
  - placement 候选筛选跳过 DB 在线但 WS 不实连的行，不再向假在线 daemon 派发
  - 极端相位差下 DB 抖动窗口上限一个心跳周期（约 15s），窗口内 placement 拒绝派发为已声明可接受行为
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_ws_disconnect_offline.py -q
  - cd backend && uv run pytest app/modules/agent/tests -q -k placement（回归既有 placement 测试）
constraints:
  - 不改变 ws_hub 现有内存结构与 RPC 取消行为，仅新增延迟任务挂载点
  - 不动 placement.py 约 1075 行 interactive 通知路径已有的 is_connected 检查
  - 不改 offline sweep 与 session 状态收敛语义（属 task-05）
  - 不跑全量测试，仅跑本 task 新增测试与 placement 回归
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
