---
id: task-05
title: 'Dual guards against thin stage wash-back'
title_zh: '阶段回洗双守卫'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-05, FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/test_thin_stage_guard.py
  - backend/app/modules/change/tests/test_thin_stage.py
target_files:
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/platform_sync/service.py
  - NEW:backend/app/modules/platform_sync/tests/test_thin_stage_guard.py
  - NEW:backend/app/modules/change/tests/test_thin_stage.py
goal: >
  在两条阶段同步路径（daemon run_sync 回调守卫 A / CLI progress 上行守卫 B）加同一谓词，防 thin 变更被 sillyspec.db 的 scan 停留态洗回，归档终态正确放行。
implementation:
  - 守卫 A：backend/app/modules/change/dispatch.py sync_stage_status（:1784-1807 回写段）——平台 change.current_stage=="thin" 且 DB 行 status!="archived" 时跳过 current_stage 回写与 stages['scan'] JSON 块写入（仅 updated_at 时间戳类照常）；DB status=="archived" 放行既有归档翻转链；非 thin 变更现状逐字不变
  - 守卫 B：backend/app/modules/platform_sync/service.py _sync_change_stage_status（:997-1004 覆盖点）——同一谓词：CLI current_stage='scan' 不覆盖平台 'thin'；status='archived' 放行（读侧三源并集 backend/app/modules/change/service.py:221-243 承接）
  - 新建 backend/app/modules/platform_sync/tests/test_thin_stage_guard.py：守卫 B 三态（thin×active 不覆盖/thin×archived 翻归档/主线阶段照常覆盖）+ watcher 事件归属两前提对账（change_name 与平台 change_key 逐字一致才挂上；workspace 不符 403 孤儿路径）
  - backend/app/modules/change/tests/test_thin_stage.py 追加守卫 A 三态（thin×active 不回写且 stages JSON 无幽灵 scan 块/thin×archived 放行翻转/主线阶段不受影响）
acceptance:
  - 两路径下 thin 变更平台阶段恒 "thin" 直到 DB 行 archived 翻转归档态
  - 非 thin 变更两路径行为与现状逐字一致（回归用例锁定）；stages JSON 无 scan 幽灵块
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_thin_stage.py app/modules/platform_sync/tests/test_thin_stage_guard.py app/modules/platform_sync/tests/test_change_events.py app/modules/change/tests/test_step_progress.py -q --no-cov
constraints:
  - platform_sync/service.py 提交按 hunk 隔离（git apply --cached 或精确行块 git add），不夹带 observation-events-v3 在途 hunks；提交前 git diff 复核
  - 守卫谓词两处单一规则（平台 thin 且 DB 非 archived → 跳过回写与 stages 写入），不引入第二套判断
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
