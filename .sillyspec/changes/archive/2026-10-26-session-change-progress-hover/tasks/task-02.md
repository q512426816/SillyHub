---
id: task-02
title: 'Add stage progress extractor'
title_zh: 'backend _extract_stage_progress 阶段进度提取器（stages/steps 分组计数+耗时秒数+revision，时钟注入；畸形 fail-open→None）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-004]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_progress_projection_ext.py
target_files:
  - backend/app/modules/change/service.py
  - NEW:backend/app/modules/change/tests/test_progress_projection_ext.py
expects_from:
  - 'task-01 contract StageProgressEntry（backend/app/modules/change/schema.py）'
goal: >
  enrich_summaries 管道新增全量变更阶段进度提取器：从 latest_progress 的 stages[]+steps[] 按阶段分组计数并计算耗时秒数，投影 ChangeSummary.stage_progress，供前端 5 圈进度行消费。
implementation:
  - 'service.py 新增 _extract_stage_progress（紧邻 _extract_step_progress 先例 backend/app/modules/change/service.py:2945 同范式）：遍历 latest_progress.stages[]（started_at/completed_at/revision/stale_reason）×steps[] 按 stage 分组——steps_total 含 waiting/blocked 全计数、steps_completed 只计 status=completed；duration_seconds=completed_at−started_at，进行中=注入 now−started_at（R-04 时钟注入保测试确定性），无 started_at→None；revision 透传'
  - '挂入 enrich_summaries（backend/app/modules/change/service.py:2294）：stage_info 命中处用已 in-手 latest_progress 调用提取器填 summary.stage_progress（零新增查询；deleted 行不投影，对齐 backend/app/modules/change/service.py:2343 防复活口径）'
  - '解析全路径防御 isinstance 判型 fail-open（R-01）：latest_progress 非 dict/stages 缺失/行畸形/时间戳坏 → 返回 None 不抛；时间戳容错复用 _normalize_completed_at 同款口径（zh-CN 旧格式）'
  - '新建 test_progress_projection_ext.py：主路径（5 阶段计数+revision+固定 now 耗时断言）/盲区#1（stages 行在而 steps 空 → steps_total=0 空圈不除零）/畸形样本（zh-CN 时间戳、非 dict 行、缺 started_at）用例'
acceptance:
  - '全量变更 latest_progress 含 stages+steps 明细时 stage_progress 输出 5 阶段 entries，计数/起止/耗时/revision 断言通过'
  - '畸形与缺失 latest_progress → stage_progress=None 不抛（FR-07 fail-open），前端该项降级现状渲染'
verify:
  - cd backend && python -m pytest app/modules/change/tests/test_progress_projection_ext.py -q
constraints:
  - '零新增 SQL 查询（latest_progress 在 enrich_summaries 已在手）；不取 datetime.now() 全局时钟（now 由参数注入）'
  - 'CLI 阶段/状态枚举原值透传不归一（未知新枚举由前端白名单外兜底，盲区#10）；不改 sillyspec CLI'
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
