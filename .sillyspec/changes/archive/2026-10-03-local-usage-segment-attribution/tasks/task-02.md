---
id: task-02
title: '上报链路——service upsert 循环内读旧值插水位 + 200 行修剪 + test_agent_log_push 用例（插水位/同 ctx 连续/ctx 空/修剪末水位保留/事务性）'
title_zh: '上报链路——service upsert 循环内读旧值插水位 + 200 行修剪 + test_agent_log_push 用例（插水位/同 ctx 连续/ctx 空/修剪末水位保留/事务性）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-03 17:50:03
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-04b]
decision_ids: [D-002@v2, D-003@v2]

allowed_paths:
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/test_agent_log_push.py
target_files:
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/test_agent_log_push.py
goal: >
  上报链路插水位：upsert 循环内行覆盖前记「ctx 接管时点已落库累计」（D-002@v2）+ 修剪豁免首末（D-003@v2）。
implementation:
  - service.py upsert 循环内（行覆盖前）：读旧行五值（invocations/usage 四维，NULL 按 0）→ INSERT 水位行（ctx=本 entry change_key/quick_id 或双空、seq=MAX(seq)+1 子查询、reported_at=now）→ 既有覆盖与绑定照旧；同事务
  - 插入后修剪：该 (workspace_id,log_path) 计数>200 时 DELETE 中段（seq 保留窗口：(min_seq, max_seq-200) 开区间删，首 min_seq 与末 200 条豁免）——单条 SQL
  - test_agent_log_push.py 用例：上报插水位（值=旧值/无旧值 0）/同 ctx 连续多次多行/ctx 双空水位照插/201 次上报首末水位仍在且中段修剪/存量带基线 entry 重推首水位 mark=基线（FR-04b 断言）；既有归属/绑定用例回归
acceptance:
  - 每次上报必插一行水位（含 ctx 双空）；修剪后 count<=201 且 min/max seq 恒在；水位值=覆盖前旧行值（时序 D-002@v2）；既有用例零回归
expects_from:
  task-01:
    - contract: platform_agent_log_usage_marks 水位行
      needs: [seq, mark_invocations, mark_input_tokens, mark_output_tokens, mark_cache_read_tokens, mark_cache_write_tokens]
related_tests:
  - backend/app/modules/platform_sync/tests/test_agent_log_push.py
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_agent_log_push.py -q --no-cov && uv run ruff check app/modules/platform_sync/service.py && uv run mypy app
constraints:
  - 与 upsert 同事务不加队列/锁；不改响应 DTO/鉴权；MAX(seq)+1 撞唯一键按既有 IntegrityError 重试一轮先例
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
