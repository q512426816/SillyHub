---
id: task-05
title: 'DS-6 巡检协程——**独立文件** backend/app/modules/daemon/sweep.py + main.py lifespan 挂载（仿 mission_patrol_loop）；60s 周期；import task-03/04 常量；lease 终态 cancelled；条件更新幂等；测试：收敛、幂等、不误伤窗口内会话'
title_zh: 'DS-6 巡检协程——**独立文件** backend/app/modules/daemon/sweep.py + main.py lifespan 挂载（仿 mission_patrol_loop）；60s 周期；import task-03/04 常量；lease 终态 cancelled；条件更新幂等；测试：收敛、幂等、不误伤窗口内会话'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-07, NFR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/sweep.py
  - backend/app/main.py
  - backend/app/modules/daemon/tests/test_session_reconnect_sweep.py
goal: >
  DS-6 后端巡检兜底（FR-07）：新增常驻协程把卡死在 reconnecting 且
  last_active_at 超时（>180s）的会话自动收敛为 failed（挂起 lease 置
  cancelled），与 DS-5 手动重试窗口构成双保险，并覆盖旧版 daemon 未升级
  不发 confirm 的过渡期。
expects_from:
  task-03:
    - contract: RECONNECTING_RETRY_WINDOW_SEC
      needs: [RECONNECTING_RETRY_WINDOW_SEC]
      note: 常量唯一落点 session/service.py（task-03 定义），本卡只 import 不重复定义；语义 = reconnecting 会话 last_active_at 距今超过该秒数（180）视为超时
implementation:
  - 新文件 backend/app/modules/daemon/sweep.py——单次扫描函数 session_reconnect_sweep_once(session)（注入 AsyncSession 便于单测，返回收敛行数 int）；单事务内条件更新 agent_sessions 置 status='failed'、ended_at=now（UTC），条件仅两条——status='reconnecting' AND last_active_at < now-RECONNECTING_RETRY_WINDOW_SEC（常量 import 自 session/service.py，软删行同样收敛，无可见影响）；时间比较在 Python 侧用 datetime.now(UTC) 算好阈值再绑定，不依赖 DB 方言时间函数（aiosqlite/PG 双方言，NFR-04）
  - 命中行的挂起 lease（session.lease_id）置 'cancelled'（design 审查 gap 修复定案——不用 'expired'，expire_leases 仅处理 lease_expires_at 非 NULL 的租约（lease/service.py:853-864），interactive lease 恒 NULL；'cancelled' 与"恢复放弃"语义一致）；仅 pending/claimed 中的 lease 置 cancelled，已终态 lease 不碰；取命中行用 UPDATE ... RETURNING 或先 SELECT id/lease_id 再两步条件 UPDATE（方言兼容按仓库 raw SQL 先例）
  - 常驻循环 session_reconnect_sweeper（interval 参数默认 60s，design DS-6 定 60s 周期）：仿 mission_patrol_loop（backend/app/modules/agent/patrol.py:490-498）——每轮经 get_session_factory() 开短 session 调 sweep_once；单轮异常 except Exception 只 log.exception 吞掉、不崩循环；await asyncio.sleep(interval) 处 CancelledError 必须透传（BaseException 不被 except Exception 吞，shutdown cancel 才能干净落地）
  - backend/app/main.py lifespan 挂载：bootstrap 完成后、yield 前对齐 :189-196 patrol_task 先例——sweep_task 先占 None（bootstrap 抛错走 finally 不炸），asyncio.create_task(session_reconnect_sweeper(), name 起名对齐 patrol 风格）；finally 中 cancel + await asyncio.gather(sweep_task, return_exceptions=True)（对齐 :213-215 手法，巡检轮内有 DB 写须等取消落地）
  - 新测试 backend/app/modules/daemon/tests/test_session_reconnect_sweep.py（连带 conftest 自动生效）：seed 四类会话（reconnecting 超时 / reconnecting 窗口内 / active / ended）+ 各自挂起 lease，直调 session_reconnect_sweep_once 断言——超时者收敛（failed + ended_at + lease cancelled）、其余三类及其 lease 原样、同数据二跑收敛 0 行
acceptance:
  - reconnecting 且 last_active_at 距今 >180s 的会话被置 failed、ended_at 写入，对应挂起 lease 置 cancelled
  - 窗口内（last_active_at 新鲜）/ active / ended / failed 的会话与其 lease 不被触碰（不误伤恢复进行中的会话）
  - 同一批数据重复执行第二次收敛 0 行（条件更新幂等，多轮/多 worker 重复无害）
  - session_reconnect_sweep_once 为无状态单次函数，测试直接调用即全覆盖，不依赖 60s 循环时序
  - main.py 挂载/关停对齐 patrol 先例，cancel + gather 后无悬挂任务
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/ -k sweep -v
  - cd backend && uv run ruff check app/modules/daemon/sweep.py app/main.py
  - cd backend && uv run mypy app/modules/daemon/sweep.py
constraints:
  - 不改 backend/app/modules/daemon/session/service.py（同文件约束——该文件归 task-03/04，Wave 排布依据）；180 魔法数不重写，一律 import RECONNECTING_RETRY_WINDOW_SEC
  - lease 终态只取 'cancelled'，不改 lease 状态机取值集合（DaemonTaskLease.status 为 free-form String(20)，model.py:351）
  - 不新增 Settings 开关/字段——巡检常开（design 未要求 enabled 开关，与 mission_patrol_enabled 先例不同），60s 周期以 interval 参数默认值表达
  - 不动 daemon/前端——本卡纯 backend 兜底收敛，与 task-06/07/08 无文件交集
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
