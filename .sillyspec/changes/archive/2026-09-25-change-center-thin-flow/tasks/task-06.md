---
id: task-06
title: 'Infer thin stage from flow-state.yaml in reparse'
title_zh: 'reparse 推断 flow-state.yaml'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P1
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change/parser.py
  - backend/app/modules/change/tests/test_parser.py
target_files:
  - backend/app/modules/change/parser.py
  - backend/app/modules/change/tests/test_parser.py
goal: >
  reparse 的阶段推断识别 flow-state.yaml 在场 → "thin"，CLI 侧自建 thin 目录不再被错标 brainstorm。
implementation:
  - backend/app/modules/change/parser.py:728-749 _infer_current_stage 增最高优先规则：变更目录含 flow-state.yaml → "thin"（优先于 proposal/design→brainstorm 推断；MASTER.md+request.md→quick 既有规则不动）
  - backend/app/modules/change/tests/test_parser.py 补用例：flow-state.yaml 在场（无论 proposal 与否）→ thin；不在场且 proposal.md 在场 → brainstorm 不回归
acceptance:
  - 含 flow-state.yaml 的变更目录 reparse 后 current_stage=="thin"
  - 无 flow-state.yaml 的目录推断行为不变（brainstorm/quick 既有用例全绿）
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_parser.py -q --no-cov
constraints:
  - 不动 _infer_change_type（change_type 三值体系不动）
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
