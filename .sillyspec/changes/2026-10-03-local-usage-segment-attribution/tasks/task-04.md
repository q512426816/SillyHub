---
id: task-04
title: '回归收口——platform_sync+change 聚焦 pytest + ruff/mypy + 模块文档同步（platform_sync.md/change.md 归属协议段）'
title_zh: '回归收口——platform_sync+change 聚焦 pytest + ruff/mypy + 模块文档同步（platform_sync.md/change.md 归属协议段）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-03 17:50:03
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]

allowed_paths:
  - .sillyspec/docs/backend/modules/platform_sync.md
  - .sillyspec/docs/backend/modules/change.md
target_files:
  - .sillyspec/docs/backend/modules/platform_sync.md
  - .sillyspec/docs/backend/modules/change.md
goal: >
  回归收口与模块文档：聚焦全绿 + 归属协议段更新（水位协议/两卡分叉声明）。
implementation:
  - platform_sync + change 聚焦 pytest（含 push/ingest/usage_stats 全量）+ ruff/mypy
  - platform_sync.md：上报节补水位协议段（插水位时序 D-002@v2/修剪豁免/存量迁移 D-004）
  - change.md：本地段补差分双路径口径 + R-08 两卡分叉声明（绑定卡=最后工作现场/用量卡=实际消耗分布）
acceptance:
  - 聚焦测试全绿；两文档段落与实现一致（注释一致性）；无 TODO 残留
verify:
  - cd backend && uv run pytest app/modules/platform_sync app/modules/change -q --no-cov && uv run mypy app
constraints:
  - 不改代码（纯收口/文档）；全量留 CI
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
