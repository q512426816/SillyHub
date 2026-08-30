---
id: task-04
title: 'complete_lease batch 单行明细 + run 列填充 + 测试'
title_zh: 'complete_lease batch 单行明细 + run 列填充 + 测试'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01-2, FR-01-4]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/tests/test_lease_model_usage.py
goal: >
  complete_lease 处理 stats.model/api_requests：落单行明细（model ?? unknown）+ run.model/llm_provider_id（仅空时）填充。
implementation:
  - lease stats 应用段扩 model_usage 单行构造
  - 补测试：stats 带/不带 model 两态
acceptance:
  - batch close 落明细行；stats 无新字段时零变化
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto -k lease
constraints:
  - 不动 stats 既有四维覆盖语义
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
