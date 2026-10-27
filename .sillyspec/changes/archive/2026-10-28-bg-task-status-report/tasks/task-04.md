---
id: task-04
title: 'backend 词表/负载校验扩展+SSE 透传（FR-02）'
title_zh: 'backend 词表/负载校验扩展+SSE 透传（FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-27 13:02:37
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/router/notify.py
  - backend/app/modules/daemon/schema.py
  - NEW:backend/app/modules/daemon/tests/test_session_bg_task_final.py
target_files:
  - backend/app/modules/daemon/router/notify.py
  - backend/app/modules/daemon/schema.py
goal: >
  backend 新端点 POST /api/daemon/sessions/{id}/bg-task-final：DTO BgTaskFinalReportRequest（run_id 必填+三值枚举+可选 output_file）、runtime owner 越权校验、落 agent_run_logs（dedup_key=bg-task:{task_id} 幂等）、publish_bg_task_final_event 发 Redis 频道 agent_session:{id}。
implementation:
  - schema.py：DTO（TurnPhaseReportRequest 同款位/风格）
  - notify.py：端点+越权校验（:344 先例）+落库（file_artifacts.py:371 撞索引先例）+发布（publish_turn_phase_event 同款）
  - 前端 SSE 信封键与 payload 逐字对齐（D-012 同纪律）
  - 测试：DTO 校验/越权拦/幂等索引/发布 payload（turn-phase 测试同目录先例）
acceptance:
  - 伪造上报被拦（非 runtime owner 403）
  - 重复 task_id 幂等（撞索引不双写）
  - SSE payload 键与前端消费契约逐字一致
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_bg_task_final.py -x
constraints:
  - 零 DB migration（dedup_key 既有索引复用）
  - SSE 信封走既有发布通道不新建频道
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
