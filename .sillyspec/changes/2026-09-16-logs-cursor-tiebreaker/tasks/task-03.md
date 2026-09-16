---
id: task-03
title: 'backend 复合游标测试（test_group_logs_pagination.py）：同 ts 150 行批两页可达零重叠 / 缺省 before_id 行为回归 / 单独 before_id 422'
title_zh: 'backend 复合游标测试（test_group_logs_pagination.py）：同 ts 150 行批两页可达零重叠 / 缺省 before_id 行为回归 / 单独 before_id 422'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_group_logs_pagination.py
target_files:
  - backend/app/modules/daemon/tests/test_group_logs_pagination.py
expects_from:
  - field: before_id (query, uuid, optional)
    from: task-02 router 透传 / task-01 service 复合过滤
depends_on: [task-01, task-02]
goal: >
  后端复合游标行为验证：同 ts 150 行批两页可达零重叠 / 缺省 before_id 回归 / 单独
  before_id 422。
implementation:
  - 用例1：单 run 事务写 150 行同 timestamp 日志（复用既有夹具手法），limit=100 带 (before=批ts, before_id=页1末行id) 翻页——页1 取 id 最大 100 行、页2 取余 50 行+更早，两页交集为空且 150 行全可达
  - 用例2：不传 before_id 只传 before（旧行为）——断言与现行 <= 语义一致（边界行包含，首行可与已加载重叠）
  - 用例3：只传 before_id 无 before → 422
acceptance:
  - 三用例断言如上，全部通过
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_logs_pagination.py
constraints:
  - 只加用例不改既有断言（缺省行为回归用例即证旧行为不变）
  - 夹具复用该文件既有构造手法，不引新依赖
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
