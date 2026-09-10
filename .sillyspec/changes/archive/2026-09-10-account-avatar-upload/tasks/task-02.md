---
id: task-02
title: 'UserRead.avatar field + UpdateMyAvatarRequest schema'
title_zh: 'UserRead.avatar + UpdateMyAvatarRequest schema'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/auth/schema.py
target_files:
  - backend/app/modules/auth/schema.py
goal: >
  auth schema.py 追加 UserRead.avatar（str | None，default=None）与
  UpdateMyAvatarRequest（extra=forbid + max_length=512），定义三态语义契约
  （值=设置、''=清除、None=不改）供 task-03 端点消费。
implementation:
  - schema.py UserRead 在 employee_no 邻域追加 avatar（str | None = None）；from_attributes 已有，GET /api/auth/me 自动带出，default=None 兼容既有 mock fixture
  - schema.py 新增 UpdateMyAvatarRequest（放 ChangePasswordRequest 邻域，风格对齐），model_config 用 ConfigDict(extra="forbid")，avatar 用 Field(default=None, max_length=512)，docstring 写明三态语义（值=设置、''=清除、None=不改）
  - max_length=512 与 users.avatar 列宽一致（design §数据模型）；不动 router/service（task-03 范围），不跑 gen:types（前端 task-05 统一）
acceptance:
  - UserRead.model_validate(user).avatar 正确透传（None / 有值两路径），GET /me 响应自动带 avatar
  - UpdateMyAvatarRequest 拒绝多余字段（extra=forbid）；avatar 超 512 字符校验失败；缺省 avatar=None
  - 既有 auth 测试零回归
verify:
  - cd backend && uv run python -c "from app.modules.auth.schema import UpdateMyAvatarRequest, UserRead; assert 'avatar' in UserRead.model_fields and 'avatar' in UpdateMyAvatarRequest.model_fields"
  - cd backend && uv run mypy app/modules/auth/schema.py && uv run ruff check app/modules/auth/schema.py
constraints:
  - 仅改 schema.py 单文件
  - 三态语义是 task-03 的实现契约；本端点清除语义=置 NULL 不存空串（审查 C-08，与群成员 PATCH 存 "" 不同）
  - CLAUDE.md 规则 0：仅跑相关检查与测试
provides:
  - contract: UserRead
    fields: [UserRead.avatar]
  - contract: UpdateMyAvatarRequest
    fields: [UpdateMyAvatarRequest.avatar]
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
