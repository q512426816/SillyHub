---
id: task-04
title: 'add-knowledge-writer-and-write-endpoints'
title_zh: '后端写侧 writer 与写端点（两段式 merge、dupRe 幂等守卫、409 冲突契约）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: ['task-01', 'task-02']
blocks: ['task-05', 'task-07']
requirement_ids: [FR-02, FR-04, FR-05, FR-07]
decision_ids: [D-005@v1, D-007@v1]
expects_from:
  - contract: KnowledgeEntryRead
    needs: [zone, filename, path]
  - contract: Permission.KNOWLEDGE_WRITE
    needs: [权限枚举值]
provides:
  - contract: KnowledgeProposeIn
    fields: [title, category, body, tags]
  - contract: KnowledgeUpdateIn
    fields: [content]
  - contract: KnowledgeMergeIn
    fields: [target_file, section_title, keywords]
  - contract: MergePreviewOut
    fields: [section_text, index_line]
related_tests:
  - backend/app/modules/knowledge/tests/test_router.py
allowed_paths:
  - backend/app/modules/knowledge/writer.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/tests/test_writer.py
  - backend/app/modules/knowledge/tests/test_router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - NEW:backend/app/modules/knowledge/writer.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/schema.py
  - NEW:backend/app/modules/knowledge/tests/test_writer.py
  - backend/app/modules/knowledge/tests/test_router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  新增 KnowledgeWriterService 与五个写端点（手工录入、条目编辑、合并预览、两段式合并、拒绝），全部写操作经 SpecWorkspaceService.apply_ops 单写者语义落盘 knowledge/ 子树，为平台提供知识直写能力与 409 冲突契约。
implementation:
  - 新增 writer.py 定义 KnowledgeWriterService，写操作构造 FileOp（op 取 add/update/delete，path 限定 knowledge/ 前缀，content base64，base_version 取 manifest 当前行版本）调用 SpecWorkspaceService.apply_ops
  - propose_manual 写 knowledge/proposed/<slug>.md，slug 为 kebab(title) 且冲突追加 -2/-3 序号，frontmatter 含 author/created_at/proposed_at/source=manual 四字段
  - update_entry 校验 zone 限定 top/generated/proposed，decisions 返回 422 附文案由归档流程维护；reject 为单段 apply_ops delete(path) 入备份区
  - preview_merge 干跑返回 MergePreviewOut（将追加段落文本与 INDEX 路由行）不落盘；路由行格式逐字复刻 CLI classify 输出（- 关键词|关键词 → [标题](文件.md#锚点)）
  - merge 两段式（段一 [update(目标文件), update(INDEX.md)] 确认无 conflict 才执行段二 [delete(proposed/<slug>.md)]），目标白名单 known-issues.md/patterns.md/conventions.md，dupRe 守卫检测目标已含同名二级标题小节则跳过追加防重试重复
  - router.py 新增五个写端点（POST propose、PATCH entries 编辑、POST preview-merge、POST merge、POST reject）全挂 require_permission(Permission.KNOWLEDGE_WRITE)，字面量路由注册在 {filename:path} 通配路由之前，apply_ops 返回 conflict 统一翻译 HTTP 409（message/conflict/server_versions）
  - 新增 tests/test_writer.py 覆盖两段式段一冲突候选保留、dupRe 重试不重复、decisions 422、409 形状、目标白名单；test_router.py 扩端点级权限与冲突用例
acceptance:
  - propose 落盘 proposed/<slug>.md 且 frontmatter 四字段齐全、slug 冲突序号唯一，列表侧待审核 zone 可见
  - merge 段一返回 conflict 时候选文件保留未删；合并已生效后重试不重复追加同名小节与 INDEX 路由行
  - 编辑 decisions zone 条目返回 422 且 message 含由归档流程维护；白名单外目标拒绝合并；409 响应含 message/conflict/server_versions 三键
verify:
  - uv run pytest backend/app/modules/knowledge -q
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - distill 派发端点与 DistillDispatchIn 属 task-07 本 task 不实现
  - 不改 apply_ops 入参契约与 quicklog 端点，不引入 daemon 代写队列，不新建 DB 表
  - merge 路由关键词来自表单人工填写不做自动派生；不改 parser 读侧（属 task-01）
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
