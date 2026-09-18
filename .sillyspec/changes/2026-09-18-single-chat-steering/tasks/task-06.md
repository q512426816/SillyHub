---
id: task-06
title: 'backend dispatch_now 引导式重构（queue.py 不再无条件 interrupt；QueueDispatchNowResponse.dispatch_mode 三态 + router 映射）'
title_zh: 'backend dispatch_now 引导式重构（queue.py 不再无条件 interrupt；QueueDispatchNowResponse.dispatch_mode 三态 + router 映射）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P0
depends_on: ['task-01']
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
blocks: [task-08, task-09]
allowed_paths:
  - backend/app/modules/daemon/session/service/queue.py
  - backend/app/modules/daemon/router/session_queue.py
  - backend/app/modules/daemon/schema.py
target_files:
  - backend/app/modules/daemon/session/service/queue.py
  - backend/app/modules/daemon/router/session_queue.py
  - backend/app/modules/daemon/schema.py
goal: >
  ⚡ 立即发送从「interrupt 打断接力派发」改为「provider 支持即 mid-turn 引导注入活跃轮」，
  响应加 dispatch_mode 三态（interrupted 保留兼容），供 task-08 队列条引导语义消费（FR-03）。
implementation:
  - 'queue.py:589 dispatch_queued_message_now（design 锚 :600-665）重构：commit 置顶次序不变，其后判 get_provider_caps(session.provider)["steering"] 且存在活跃 run → 复用 _inject_mid_turn_into_run（control.py:92，mid_turn 置位 :241）注入该条目（留痕转挂活跃 run），不再走 :661-665 无条件 interrupt；不支持或空闲 → 维持现状（interrupt 接力 / dispatch_queued_messages 当场派发）'
  - 'dispatch_queued_message_now 返回值由单一 interrupted 布尔改为可派生三态的结果（mid_turn/interrupted 标志），供 router 层映射'
  - 'schema.py:550-562 QueueDispatchNowResponse 加 dispatch_mode: Literal["steered","interrupted","dispatched"]（mid_turn→steered、interrupted=True→interrupted、空闲当场派发→dispatched）；现 interrupted: bool 保留兼容不删'
  - 'router/session_queue.py:197-198 端点映射改为构造 dispatch_mode 三态返回（interrupted 照旧填充）'
acceptance:
  - '支持 provider + 忙轮 ⚡ → 未下发 SESSION_INTERRUPT（断言 hub 无 interrupt 控制）、条目 mid-turn 注入活跃 run、响应 dispatch_mode=steered 且 interrupted=false'
  - '不支持 provider（cursor/未知）+ 忙轮 ⚡ → 维持现状 interrupt 接力（dispatch_mode=interrupted）；空闲态当场派发（dispatch_mode=dispatched）——降级行为与现状一致'
  - 'interrupted 字段保留且语义正确（兼容不删）；非 active 409 / 条目 404 / failed 重置与置顶持久化次序（commit 先于发送，R-03）零回归'
  - '既有 dispatch_now 用例 idle/404/409/failed reset 零回归；busy interrupt 两用例（claude fixture）随三态语义在 task-09 同步迁移（fixture 换不支持引导 provider 或断言改 steered）'
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_session_queue_actions.py -k "dispatch_now and not busy and not interrupt_failure"
constraints:
  - 'dispatch_now 现有 interrupted: bool 保留兼容不删；dispatch_mode 由 mid_turn/interrupted 派生，不新建平行服务层字段'
  - '复用 _inject_mid_turn_into_run（control.py:92）不另写第二条注入链路；群聊 @ steering 同入口零回归；停止按钮 interrupt 语义与非 active 409 零回归'
  - '测试文件改动与 OpenAPI（openapi.json + pnpm gen:types）同步归 task-09，本任务不跑生成链；禁跑全量测试'
expects_from:
  task-01:
    - contract: provider_caps steering 键
      needs: [get_provider_caps steering 键取值（pi/claude/codex=true）]
provides:
  - contract: QueueDispatchNowResponse.dispatch_mode
    fields: [dispatch_mode 三态（interrupted 保留兼容；消费方 task-08）]
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
