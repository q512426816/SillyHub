---
id: task-04
title: '后端 pytest 五组（收/取/去重/鉴权/上限）'
title_zh: '后端 pytest 五组（收/取/去重/鉴权/上限）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-23 04:16:42
priority: P0
depends_on: ['task-01', 'task-02', 'task-03']
blocks: [task-08]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-002, D-005, D-007]
allowed_paths:
  - backend/app/modules/platform_sync/tests/test_change_events.py
target_files:
  - NEW:backend/app/modules/platform_sync/tests/test_change_events.py
goal: >
  pytest 五组：收/取/去重/鉴权/上限（test_quicklog_push.py 同范式，conftest shpsync_headers 复用）。
implementation:
  - 收：POST 批量 2 条 shpsync_ 200 + accepted=2 落库字段核对（kind/stage/detail/ts 归一/provisional 恒 True 含伪造 False 入参）+ 批量>200 422 + ts 秒级值域 422
  - 取：GET 默认正序（乱序推入后 ts ASC）+ since 增量严格大于不含边界 + limit 生效 + 空列表 200
  - 去重：同批重放 deduplicated=accepted 首次、0 二次；带 id 事件按 id 去重
  - 鉴权：无凭据 401 / shk_live_ 403 / JWT 403（auth_headers fixture）/ shpsync_ 200；跨 workspace token 读不到他人事件
  - 上限：循环推 5005 条（批量拼装）→ count=5000 且最旧被修剪（FR-03）
acceptance:
  - 五组用例全部通过（≥13 用例）
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_change_events.py -q
constraints:
  - 只测本变更端点，不动既有测试文件（CLAUDE.md 规则 0：只跑相关测试）
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
