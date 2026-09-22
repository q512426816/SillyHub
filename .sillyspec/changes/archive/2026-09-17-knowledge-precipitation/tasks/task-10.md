---
id: task-10
title: 'update module docs, run adjacent-face regression, and recheck against prototype'
title_zh: '模块文档增量 + 相邻面回归 + 原型对照复核'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-004@v1, D-005@v1, D-007@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/modules/knowledge.md
  - .sillyspec/docs/SillyHub/modules/spec_workspace.md
  - .sillyspec/docs/SillyHub/modules/auth.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.md
  - .sillyspec/changes/2026-09-17-knowledge-precipitation/module-impact.md
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  文档与实现一致性收口——knowledge 模块卡补写侧契约并更新「不再只读」定位，spec_workspace/auth/frontend_components 按影响面补增量，对照原型逐项复核最终 UI，跑相邻面回归确认零回归。
implementation:
  - knowledge.md——补写侧契约（propose/entries PATCH/preview-merge/merge/reject/distill 端点语义、KnowledgeWriterService 两段式 merge 与 dupRe 幂等守卫、409 冲突契约、字面量路由注册在通配路由之前、proposed frontmatter 字段）与「不再只读」定位更新；quicklog 面描述不动
  - spec_workspace.md——apply_ops 调用方清单补 knowledge writer 新调用方说明（单写者语义不变，D-005）；auth.md——权限点清单补 KNOWLEDGE_WRITE 与角色播种 migration 说明（R-06）
  - frontend_components.md——补 knowledge 新组件（precipitate-dialog 双 tab、merge-dialog、entry-editor、distill-task-bar）与知识库页 zone 分组树/待审核徽标变更
  - 原型对照复核——按 prototype-knowledge-precipitation.html 逐项核对最终实现 UI（zone 树、待审核徽标、沉淀弹层双 tab、合并预览、编辑态、蒸馏任务条），偏差逐项登记并注明理由
  - 相邻面回归——backend 跑 knowledge（含 quicklog 面）/scan_docs/spec_workspace 相关测试，frontend 跑知识库页组件测试 + tsc，确认零回归
  - module-impact.md「更新结果」表按规则回填 done（确定不同步的行改 skipped 并在操作列写明原因）
acceptance:
  - 四份模块文档增量落地且与实现一致（文档与实现不一致处以实现为准修文档，CLAUDE.md 规则 18）
  - 原型对照复核完成，偏差逐项登记（可接受偏差注明理由）
  - 相邻面回归全绿零失败；module-impact.md 更新结果表已回填
verify:
  - cd backend && uv run pytest app/modules/knowledge app/modules/scan_docs app/modules/spec_workspace -q
  - cd frontend && pnpm exec tsc --noEmit && pnpm test knowledge
  - git diff 审阅四份模块文档与 module-impact.md（与 design.md 文件变更清单/接口定义一致）
constraints:
  - 只改文档不改代码——发现文档与实现不一致，以实现为准修文档，不为对齐文档去改代码
  - 相邻面只跑 quicklog/scan_docs/spec_workspace 与 knowledge 面，不跑全量测试（CLAUDE.md 规则 0）
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
