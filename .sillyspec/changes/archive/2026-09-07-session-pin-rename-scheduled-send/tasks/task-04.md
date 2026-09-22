---
id: task-04
title: 'scheduled-send-sweeper-and-lifespan-registration'
title_zh: 'scheduled_send sweeper 单趟四分支+常驻循环+lifespan 注册'
author: 'qinyi'
created_at: 2026-09-07 23:32:13
priority: P0
depends_on: ['task-03']
blocks: ['task-06']
requirement_ids: [FR-05]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/scheduled_send.py
  - backend/app/main.py
target_files:
  - NEW:backend/app/modules/daemon/scheduled_send.py
  - backend/app/main.py
goal: >
  新建 scheduled_send.py 定时派发 sweeper——到点 pending 条目行锁复核后按四分支收敛
  （空闲 dispatched / 忙轮入既有队列 / 终态 failed session_inactive / 队列满 failed
  queue_full），复用 inject_session_as_service 全链路，照 session_reconnect_sweeper
  三段契约接入 main.py lifespan 常驻（FR-05，D-001@v1 方案 B / D-003@v1）。
implementation:
  - 新建 scheduled_send.py——常量 SCHEDULED_SEND_SWEEP_INTERVAL_SEC=30；scheduled_send_sweep_once(db_session) 单趟，Python 侧 datetime.now(UTC) 算好绑定参数（aiosqlite/PG 双方言），SELECT status=pending 且 dispatch_at<=now 一次限 50 条（防长事务，走 ix_agent_ssm_session_status_dispatch 索引）
  - 逐条独立短 session 处理（get_session_factory 模式，对齐 dispatch_next_queued_message 独立 session 先例）——条目行锁 with_for_update 复核 status=pending（R-01 取消竞态，非 pending 幂等跳过）；会话终态（ended/failed）或 deleted_at 非空 → 置 failed + error_code=session_inactive 不盲发
  - 否则调 SessionService.inject_session_as_service(session_id, prompt, queue_when_busy=True, queue_sender_user_id=条目 sender_user_id, attachment_ids 由 str 快照转回 uuid.UUID, agent_profile_id, llm_provider_id)——忙轮自动落既有排队；成功后独立事务置 dispatched + dispatched_at（与 inject 分两个事务，R-02 at-least-once 权衡写进注释）
  - inject 抛 AppError（app/core/errors.py）→ 置 failed + error_code/error_message；DaemonSessionQueueFull（session/service.py:455）单列 error_code=queue_full（D-003@v1 不自动延后重试）；单条失败仅落库不中断同轮其它条目
  - scheduled_send_sweeper(interval=SCHEDULED_SEND_SWEEP_INTERVAL_SEC) 常驻循环照 sweep.py session_reconnect_sweeper 模式——每轮独立短 session、单轮异常 log.exception 吞掉不崩循环、asyncio.sleep 处 CancelledError 透传
  - main.py lifespan 注册——占位 None → create_task(scheduled_send_sweeper(), name=scheduled-send-sweeper) → finally cancel + await gather（对齐 sweep_task 三段关停契约）
acceptance:
  - sweep_once 四分支符合 FR-05——空闲→dispatched；忙轮→消息入既有排队且条目 dispatched；终态/软删→failed(session_inactive)；队列满 5→failed(queue_full)
  - 派发前行锁复核 pending，已取消/已派发条目幂等跳过不重发；单条失败不连坐同轮其它条目
  - backend 重启后 pending 条目启动首轮即捞，≤30s 补发（due 即捞）
  - lifespan 关停 cancel + gather 落地无悬挂协程；单轮异常不崩循环
verify:
  - cd backend && uv run ruff check app/modules/daemon/scheduled_send.py app/main.py
  - cd backend && uv run mypy app
constraints:
  - 不写测试——sweeper 四分支用例归 task-06，本卡只交实现且 ruff/mypy 干净
  - 不改 daemon 与 SESSION_INJECT 通道、不改 inject_session_as_service 语义（纯调用方零改动）
  - 不加 Settings 开关——巡检常开，30s 周期为 interval 参数默认值（对齐既有 sweeper 定案）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
