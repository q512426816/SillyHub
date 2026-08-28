---
id: task-05
title: 'get_runtimes_usage by_provider 查询（COALESCE 去重沿用）+ runtime 测试'
title_zh: 'get_runtimes_usage by_provider 查询（COALESCE 去重沿用）+ runtime 测试'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-04-1, FR-04-3]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/tests/test_runtime_usage_by_provider.py
goal: >
  get_runtimes_usage 新增 by_provider 查询（明细表 JOIN runs LEFT JOIN providers，同窗同 COALESCE 去重，NULL 归「未记录」），summary/daily 原样零回归。
implementation:
  - _build_by_provider_sql（复用方言分支 cmp 逻辑）
  - RuntimeUsageRead.by_provider 装配 + 测试（PG/SQLite 方言双跑既有模式）
acceptance:
  - 窗口内明细聚合正确且 runtime 双挂不重复计
  - 既有 summary/daily 断言零变化
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto -k runtime_usage
constraints:
  - 只读查询；不加索引（量级小，design R-04）
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
