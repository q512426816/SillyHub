---
id: task-03
title: 'Router: await orchestration'
title_zh: '路由协作（端点 await 化）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 21:45:00
priority: P0
depends_on: ["task-02"]
blocks: ["task-05"]
requirement_ids: [FR-04]
decision_ids: [D-005@v2]
allowed_paths:
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/tests/test_router.py
target_files:
  - backend/app/modules/knowledge/router.py
provides:
  - contract: endpoint_unchanged
    fields: [signature, response_model, permission_filter]
expects_from:
  task-02:
    - contract: search_sync(async)
      needs: [results, model_ready, reason]
goal: >
  search 端点从 run_in_threadpool 整体卸载改为直接 await async search_sync（CPU 面已内部分段卸载）；端点签名/响应模型/权限过滤零改动。
implementation:
  - router.py search_knowledge：删 run_in_threadpool 包装→await search_sync(...)；session_factory 显式传入（app.core.db.get_session_factory()）
  - query 截断/limit 钳位/权限过滤/降级组装逻辑全部不动
  - test_router 既有搜索 8 例适配（httpx AsyncClient 端到端无感；fake embedder monkeypatch get_embedder 路径确认仍生效）；如有直接调 search_sync 的用例改 await
acceptance:
  - 端点行为与响应形态零变化（8 例全绿）；git diff backend/openapi.json 零输出
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_router.py -q --no-cov
constraints:
  - MUST NOT 改端点签名/响应模型/schema.py
  - MUST NOT 触 gen:types（契约冻结）
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
