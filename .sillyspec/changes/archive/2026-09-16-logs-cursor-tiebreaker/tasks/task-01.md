---
id: task-01
title: 'read_model.py get_agent_session_logs 新增 before_id 参数与复合过滤分支（(ts<before) OR (ts=before AND id<before_id)；缺省保持 <= 现行语义逐字一致），docstring 游标段同步'
title_zh: 'read_model.py get_agent_session_logs 新增 before_id 参数与复合过滤分支（(ts<before) OR (ts=before AND id<before_id)；缺省保持 <= 现行语义逐字一致），docstring 游标段同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/read_model.py
target_files:
  - backend/app/modules/daemon/session/service/read_model.py
goal: >
  get_agent_session_logs 新增可选 before_id 参数与复合过滤分支，同 ts 批次逐页可达且
  边界零重叠；缺省分支与现行 <= 语义逐字一致（旧客户端零回归）。
implementation:
  - 签名加 before_id: uuid.UUID | None = None（after/before 之间或之后，关键字参数）
  - before 非空时分支：before_id 非空 → or_(AgentRunLog.timestamp < before, and_(AgentRunLog.timestamp == before, AgentRunLog.id < before_id))；否则保持现行 timestamp <= before 逐字不动
  - docstring ``before`` 游标段同步复合语义（含排序前提：run 块序与裸 ts 过滤键不对齐为既有局限，复合过滤仅块内收紧不扩大）
acceptance:
  - before_id=None 时生成的 SQL 过滤与改动前逐字一致（现行语句原样保留）
  - before_id 非空时过滤为 (ts < before) OR (ts = before AND id < before_id)，ORDER BY（:409-414）零改动
verify:
  - cd backend && uv run ruff check app/modules/daemon/session/service/read_model.py && uv run ruff format --check app/modules/daemon/session/service/read_model.py && uv run mypy app
constraints:
  - 不改 ORDER BY / limit / reverse 语义
  - 不动 after 与 q 过滤分支
  - PG uuid 全序比较直接用 < （不加 cast）
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
