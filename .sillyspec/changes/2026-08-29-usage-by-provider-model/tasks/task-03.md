---
id: task-03
title: 'close_interactive_run 明细 upsert + run 列填充（llm_provider_id 仅空时填，model 终态填）+ 测试'
title_zh: 'close_interactive_run 明细 upsert + run 列填充（llm_provider_id 仅空时填，model 终态填）+ 测试'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01-2, FR-01-3]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/tests/test_run_sync_model_usage.py
goal: >
  close_interactive_run 处理 payload.model_usage/api_requests：明细行 delete+insert 幂等落库，run.model 终态填最大消耗行模型，llm_provider_id 仅空时填（R-08）。
implementation:
  - close 链路解析 model_usage（缺省跳过，老 daemon 兼容）
  - 事务内 delete(run_id)+insert(all) 等价 upsert；run.model/llm_provider_id 填充按 design §1.2
  - 异常 best-effort try/except warn 不阻塞 close
acceptance:
  - 带 model_usage 的 close 落明细行且四维正确；重放同 payload 幂等
  - 无 model_usage 的 close 行为零变化（老 daemon 兼容）
  - llm_provider_id 已有值时不被覆盖
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto -k 'model_usage or close_interactive'
constraints:
  - 不做存量回填；明细落库失败不阻塞 run 终态
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
