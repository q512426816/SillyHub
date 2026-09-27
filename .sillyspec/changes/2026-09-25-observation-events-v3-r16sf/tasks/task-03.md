---
id: task-03
title: 'Evolve change events write endpoint for v3 semantics'
title_zh: '写入端点 v3 语义（批 500/64KB/接收序剪枝/关态 422）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 00:55:16
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-003@v1, D-006@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_change_events_v3.py
target_files:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/router.py
  - NEW:backend/app/modules/platform_sync/tests/test_change_events_v3.py
expects_from:
  task-01:
    - contract: PlatformChangeEventDetailText
      needs: [detail]
  task-02:
    - contract: ObservationEventsV3Flag
      needs: [enabled]
goal: >
  写端点原地分支：schema 静态批上限 500（pydantic v2 max_length），service 增 v3 语义
  参数（detail 截 65536/剪枝 (created_at,id)），router 关态批>200 手动 422——关态行为
  逐字不变（D-009 方案 A）。
implementation:
  - backend/app/modules/platform_sync/schema.py:648 ChangeEventPushRequest.events 的 Field(max_length) 200→500
  - backend/app/modules/platform_sync/service.py append_events 增仅关键字参数 v3（bool=False）：detail 截断 2000/65536 双态（新常量 _CHANGE_EVENT_DETAIL_MAX_V3=64*1024）、剪枝 ORDER BY (ts,created_at,id)/(created_at,id) 双态（service.py:2025-2048 处分支）
  - backend/app/modules/platform_sync/router.py push_change_events：入口调 observation_events_v3_enabled 传 v3；关态 len(body.events)>200 抛 422（中文 detail，状态码与 v2 一致，body 结构差异已登记 design R-03）
  - 新建 test_change_events_v3.py 写侧双态用例：开态 499/500 收、501 拒 422；关态 201 拒 422；开态 detail 65537 字符截 65536 与关态 2001 截 2000；开态超 5000 行剪枝删 created_at 最旧（构造业务 ts 与接收序背离验证接收序语义）
acceptance:
  - 既有 test_change_events.py 零改动全绿（关态逐字不变验收锚点）
  - 开态批 500 收 / 501 拒 422；关态 201 拒 422
  - 开态剪枝按 (created_at,id) 删最旧；detail 截断 65536 字符（三层逐字对齐口径）
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_change_events.py app/modules/platform_sync/tests/test_change_events_v3.py -q --no-cov
  - cd backend && uv run ruff check app/modules/platform_sync && uv run mypy app
constraints:
  - 关态路径行为逐字不变：v2 剪枝序/2000 截断/422 状态码/dedup 键（_change_event_dedup_key 不动）/IntegrityError 一轮重试骨架不动
  - provisional 恒 True 红线与 service 零业务判定红线不动
  - 不新增端点；错误文案中文
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
