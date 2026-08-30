---
id: task-03
title: 'wire usage summaries into enrich pipelines'
title_zh: '后端批量摘要投影（enrich_summaries 尾段 + quicklog 列表组装处，零 N+1）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-02']
blocks: [task-05]
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/router.py
expects_from:
  task-02:
    - contract: ChangeUsageQueryService
      needs: [summarize_changes, summarize_quicklogs]
goal: >
  把批量 usage 摘要挂进变更列表 enrich_summaries 尾段与 quicklog 列表组装处，让两个列表响应内嵌 usage 字段且全程零 N+1。
implementation:
  - service.enrich_summaries 尾段收集非 deleted 行 change id 集合，一次调用 summarize_changes 构建 id 到摘要映射填充 summary.usage；空集合零查询
  - deleted 变更行 usage 恒 None——既有 location 为 deleted 的 continue 分支先于尾段投影，天然不作用
  - router.list_quicklog_entries 组装 items 处以页内 ql_id 集合调用 summarize_quicklogs 批量填 usage（对齐 modules_by_ql 组装先例）
  - ChangeService 内构造 ChangeUsageQueryService 复用同一 AsyncSession
acceptance:
  - 列表响应每项含 usage 摘要，单页仅新增一次批量聚合查询（R-03）
  - 无执行条目 usage 为 None；deleted 变更行 usage 恒 None；既有 test_enrich_projection 用例不回归
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/change/service.py app/modules/change/router.py && uv run mypy app
constraints:
  - R-03 禁 N+1——批量模式对齐 _resolve_user_names 先例，禁止逐行查询
  - 零迁移不加表列；不改 daemon
  - 旧客户端兼容——usage 为 optional 字段缺省 None
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
