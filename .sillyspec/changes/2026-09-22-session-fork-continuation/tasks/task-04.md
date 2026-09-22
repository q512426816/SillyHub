---
id: task-04
title: '轮锚点回填——submit_commit.py claude 轮终态写 AgentRun.engine_anchor+单测（depends_on: task-01）'
title_zh: '轮锚点回填——submit_commit.py claude 轮终态写 AgentRun.engine_anchor+单测（depends_on: task-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service/submit_commit.py
  - backend/app/modules/daemon/tests/test_engine_anchor.py
target_files:
  - backend/app/modules/daemon/run_sync/service/submit_commit.py
  - NEW:backend/app/modules/daemon/tests/test_engine_anchor.py
goal: >
  原生分叉的定位数据面：claude 轮终态提交时把该轮末 chain-entry 消息 UUID 回填 AgentRun.engine_anchor（task-01 新列），供 fork 服务取锚。
implementation:
  - backend/app/modules/daemon/run_sync/service/submit_commit.py 轮终态收口处（:194-197 session_id 回填点同款语义）从该轮已提交消息中取 claude 末条 chain-entry 消息 UUID 写 run.engine_anchor
  - 分档回填（D-010）：claude=轮末 chain-entry UUID（轮终态写）；pi=该轮首条用户消息 entryId（user_input 落库时写——entryId 来源=daemon 上报链 metadata，可得性现场实测：可得则实现，不可得则停人裁决 pi 降 seed，禁止自行降档）；codex 路径零改动（列恒 NULL）
  - 新建 backend/app/modules/daemon/tests/test_engine_anchor.py：claude 轮回填/pi 轮 user entryId 回填/codex 轮不写/空轮不写/重复提交不覆盖（锚点取轮内最新）
acceptance:
  - claude 轮终态后 run.engine_anchor=末条 chain-entry UUID；pi 轮首条用户消息落库后=其 entryId
  - codex 会话与存量路径零变化
  - 五类场景单测全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_engine_anchor.py -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon/run_sync/service/submit_commit.py && uv run mypy app --no-error-summary 2>&1 | tail -1
constraints:
  - 锚点消息类型若与 task-02 claude spike 结论冲突，以 spike 结论（D-008）为准并在此对齐
  - 不改 submit_messages 既有去重/覆盖语义
  - 禁跑全量测试
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
