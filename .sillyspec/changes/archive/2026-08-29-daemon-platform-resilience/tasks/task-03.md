---
id: task-03
title: 'backend-lease-expiry-sweeper-and-lifespan-recovery'
title_zh: 'backend lease 过期 GC 常驻协程 + lifespan 重启恢复扩展'
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-07]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/sweep.py
  - backend/app/modules/daemon/lease/service.py
  - backend/app/main.py
  - backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py
goal: >
  新增 lease_expiry_sweeper 常驻协程（60s 周期）接线既有但无调用方的 lease 过期回收函数，并在 lifespan 启动时对在线 daemon 的 pending batch lease 重发 WS 唤醒，补齐 backend 重启后自动收敛。
implementation:
  - sweep.py 新增 lease_expiry_sweeper 常驻循环，模式同 session_reconnect_sweeper（sweep.py 254 行先例），每轮调用 lease/service.py 的 expire_leases（897 行）与 handle_expired_leases_batch（1060 行）及 lease_service.py 的 alert_stuck_terminating_leases（315 行）
  - main.py lifespan 参照 session_reconnect_sweeper 挂载方式（main.py 215 行附近）create_task 启动 lease_expiry_sweeper，应用关闭时取消协程
  - main.py lifespan 启动阶段对在线 daemon 的 pending batch lease 重发 WS 唤醒，复用 placement._send_ws_wakeup（placement.py 1675 行，仅复用不修改）
  - 新增 backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py 覆盖 sweeper 周期调用三函数与 lifespan 重唤醒只针对在线 daemon 的 pending batch lease
acceptance:
  - lease_expiry_sweeper 以 60s 周期调用 expire_leases 与 handle_expired_leases_batch 与 alert_stuck_terminating_leases，三个既有函数语义不变仅新增调用方
  - claimed batch lease 心跳停后由 sweeper 收敛为过期重派（小于 3 次）或 run failed（大于等于 3 次）
  - backend 重启 lifespan 启动时对在线 daemon 的 pending batch lease 重发 WS 唤醒，不在线 daemon 不重发
  - 重唤醒幂等，重复重启不产生重复副作用
  - sweeper 随 lifespan 关闭被取消，无协程泄漏
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_lease_expiry_sweeper.py -q
constraints:
  - expire_leases/handle_expired_leases_batch/alert_stuck_terminating_leases 三个既有函数只接线调用不修改语义
  - 不改 reconnecting 会话 180s sweeper 与 offline sweep 语义（属既有行为与 task-05）
  - 新协程用例显式控制时钟与事件循环，避免与既有后台协程测试互相干扰（风险登记 R10）
  - 不跑全量测试，仅跑本 task 新增测试
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
