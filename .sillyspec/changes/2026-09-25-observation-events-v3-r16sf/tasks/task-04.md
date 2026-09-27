---
id: task-04
title: 'Evolve change events read endpoint for v3 semantics'
title_zh: '读取端点 v3 语义（received_at 游标/缺省 2000+truncated/响应字段）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 00:55:16
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v1, D-004@v1]
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
  task-02:
    - contract: ObservationEventsV3Flag
      needs: [enabled]
provides:
  - contract: ChangeEventListResponseV3
    fields: [truncated, v3, receivedAt]
goal: >
  读端点原地分支：limit 缺省双态（关 500/开 2000）、since 语义改 received_at（created_at，
  id 决胜）、无 since 取最近 2000 反转正序、响应增 truncated/v3/receivedAt（exclude_none
  保证关态 JSON 逐字节同 v2）——乱序晚到的早 ts 事件不再被游标永久丢失（D-002）。
implementation:
  - backend/app/modules/platform_sync/router.py list_change_events：limit Query 改 int|None（ge=1 le=5000，缺省 None→关态 500/开态 2000）；入口读开关传 v3
  - backend/app/modules/platform_sync/service.py list_events 增仅关键字参数 v3：since 过滤列 ts/created_at 双态；开态无 since 按 created_at DESC, id DESC 取 limit 条后反转正序返回；开态有 since 按 created_at ASC, id ASC
  - backend/app/modules/platform_sync/schema.py：ChangeEventListResponse 增可选 truncated/v3；ChangeEventItem 增可选 receivedAt（created_at ISO 8601）；router 组装 truncated = total > len(items) + response_model_exclude_none
  - test_change_events_v3.py 追加读侧双态用例：乱序推入（早 ts 晚到）+ created_at 游标增量不丢；缺省 2000 条 + truncated 标记 + 正序返回；since 游标取末条 receivedAt 连续；关态缺省 500、响应无 truncated/v3/receivedAt 字段、since 仍 ts 语义
acceptance:
  - 关态响应 JSON 与 v2 逐字节一致（新字段经 exclude_none 不出现）且既有 test_change_events.py 零改动全绿
  - 开态乱序晚到的早 ts 事件可被 since 增量取到（不丢）
  - 开态缺省返回最近 2000 条正序 + truncated=total>len(items)；receivedAt 为 ISO 8601
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_change_events.py app/modules/platform_sync/tests/test_change_events_v3.py -q --no-cov
  - cd backend && uv run ruff check app/modules/platform_sync && uv run mypy app
constraints:
  - 关态 since 语义/排序/缺省 500 不变；total 语义不变（过滤后总数不含 limit 截断）
  - 排序一律 id 决胜消并列歧义
  - truncated 由 router 组装、service 签名不变；错误文案中文
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
