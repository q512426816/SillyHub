---
id: task-05
title: 'Regression closure + measured backfill'
title_zh: '回归收口与实测回填'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 21:45:00
priority: P0
depends_on: ["task-02", "task-03"]
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - .sillyspec/docs/backend/modules/knowledge.md
  - NEW:.sillyspec/docs/backend/modules/knowledge.changelog.md
target_files: []  # 模块卡/changelog 为流程产物（铁律：只写主仓，不进 worktree diff 面），实际交付见 verify-result「文档同步」记录
expects_from:
  task-02:
    - contract: search_sync(async)
      needs: [results, model_ready, reason]
  task-03:
    - contract: endpoint_unchanged
      needs: [signature, response_model]
goal: >
  全量回归（后端 199+前端 46）+ 契约零 diff 物证 + 模块卡同步 + 重启/差量实测回填。
implementation:
  - 回归：uv run pytest app/modules/knowledge/tests -q；前端两页 vitest（零源码改动纯回归）
  - 契约物证：git diff backend/openapi.json frontend/src/lib/api-types.ts sillyhub-daemon/src/api-types.ts 三者空输出
  - 模块卡 knowledge.md 检索层存储形态段更新（内存→pgvector 两表+懒同步差量+async 编排）+ changelog sidecar 条目
  - 实测回填：SQLite 面差量只重嵌变更文件（embed_calls）+ 二次查询零嵌入——写 verify-result；生产 PG 面首查耗时标注「部署后实测」（本地无 PG vector 环境，SQLite 面全链已测）
  - ruff/mypy（knowledge 模块）
acceptance:
  - 199+46 全绿；三契约文件 git diff 空；模块卡/changelog 更新；实测数字落盘
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests -q --no-cov
constraints:
  - 禁跑全量测试（规则 0）
  - 模块卡写主仓绝对路径（铁律）
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
