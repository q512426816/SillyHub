---
id: task-03
title: 'PATCH /api/auth/me/avatar endpoint + service + four-state tests'
title_zh: 'PATCH /api/auth/me/avatar 端点 + service + 四态测试'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/auth/router.py
  - backend/app/modules/auth/service.py
  - NEW:backend/tests/modules/auth/test_my_avatar.py
target_files:
  - backend/app/modules/auth/router.py
  - backend/app/modules/auth/service.py
  - NEW:backend/tests/modules/auth/test_my_avatar.py
goal: >
  新增 PATCH /api/auth/me/avatar（登录态，body 为 UpdateMyAvatarRequest，返回更新后 UserRead），
  service 层实现三态更新语义并补四态测试（设置/清除/未登录 401/超长 422）。
implementation:
  - service.py AuthService 新增 async update_my_avatar(*, user_id, avatar) -> User（对齐 change_password 的统一 commit 风格），get User 后按 avatar 三态分派（值=写入、''=置 None、None=跳过），updated_at 刷新后 commit + refresh 返回 user
  - router.py 新增 @router.patch("/me/avatar", response_model=UserRead) 端点，依赖对齐 change_password（get_current_user 当前用户 + SessionDep + SettingsDep，参数序一致），导入 UpdateMyAvatarRequest
  - 新建 tests/modules/auth/test_my_avatar.py（风格照 test_change_password.py，user_with_token fixture + Bearer 头）四态——设置（200，响应与 users.avatar 同值）、清除（'' → 200，列置 NULL）、未带 token 401、513 字符 422；另断言 avatar 缺省（None）不改库值、GET /api/auth/me 带出 avatar
acceptance:
  - PATCH /me/avatar——值 → users.avatar 存值且响应同值；'' → 列置 NULL（非存空串）；None → 不改；未带 token → 401；>512 字符 → 422
  - 响应为更新后 UserRead（非 204）；不新增错误类型，复用 change_password 既有异常体系，既有 auth 测试零回归
verify:
  - cd backend && uv run pytest tests/modules/auth/test_my_avatar.py -q --no-cov
constraints:
  - 语义铁律（审查 C-08）：空串=清除置 NULL，不存空串（与群成员 PATCH 存 "" 行为不同、可见语义一致）
  - 端点依赖与参数序对齐 change_password（SessionDep + get_current_user + SettingsDep）
  - CLAUDE.md 规则 0 仅跑本测试文件；规则 8 检查既有测试影响
expects_from:
  task-01: [{contract: users.avatar, needs: [users.avatar]}]
  task-02: [{contract: UserRead, needs: [UserRead.avatar]}, {contract: UpdateMyAvatarRequest, needs: [UpdateMyAvatarRequest.avatar]}]
provides:
  - contract: "PATCH /api/auth/me/avatar"
    fields: ["PATCH /api/auth/me/avatar", "UserRead 响应"]
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
