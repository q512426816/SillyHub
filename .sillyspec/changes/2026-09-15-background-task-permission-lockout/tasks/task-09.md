---
id: task-09
title: '重启终态化补错误码——_cleanup_stale_runs_impl failed 分支写 error_code=SERVICE_RESTART_INTERRUPTED + error_detail'
title_zh: '重启终态化补错误码——_cleanup_stale_runs_impl failed 分支写 error_code=SERVICE_RESTART_INTERRUPTED + error_detail'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
target_files:
  - backend/app/modules/agent/service.py
  - NEW:backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py
goal: >
  _cleanup_stale_runs_impl 的 failed 分支补写 error_code=SERVICE_RESTART_INTERRUPTED
  与 error_detail，使重启中断的 run 可被稳定识别与归因（FR-04）。
implementation:
  - "在 backend/app/modules/agent/service.py 的 _cleanup_stale_runs_impl failed 分支
    （:2428-2432）增加 error_code='SERVICE_RESTART_INTERRUPTED' 与
    error_detail={\"reason\": \"backend service restarted while run was active\",
    \"finished_by\": \"startup_cleanup\"}。"
  - completed 恢复分支（:2419-2426）不写 error_code / error_detail，保持现状。
  - 新建 backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py 覆盖
    failed 分支 error_code / error_detail 断言与 completed 恢复分支不写断言。
acceptance:
  - 重启残留的 running run 被置 failed 且 error_code='SERVICE_RESTART_INTERRUPTED'、
    error_detail 含 reason 与 finished_by。
  - 有完整元数据被恢复为 completed 的 run 不写 error_code / error_detail。
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_cleanup_stale_runs_error_code.py -q --no-cov
constraints:
  - 注释与实现一致（CLAUDE.md 规则18）。
  - 不引入无关变更；只动 _cleanup_stale_runs_impl 的 failed 分支与新增测试文件。
  - 不许跑全量测试套件（CLAUDE.md 规则0）。
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
