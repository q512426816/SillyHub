---
id: task-02
title: '列表端点 list_workspaces 平台分支收窄为仅 platform:admin（docstring 同步改写 ql-20260917-007 段落）'
title_zh: '列表端点 list_workspaces 平台分支收窄为仅 platform:admin（docstring 同步改写 ql-20260917-007 段落）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 18:03:09
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/workspace/router.py
target_files:
  - backend/app/modules/workspace/router.py
goal: >
  列表端点三口径对齐之一：list_workspaces 的 ql-20260917-007 平台分支从
  「workspace:read 或 platform:admin → 全量」收窄为「仅 platform:admin → 全量」，
  避免判定链收紧后出现「列表看得见、点进去 403」的新割裂。
implementation:
  - 改 backend/app/modules/workspace/router.py:351-362 非管理员分支：collect_permissions_platform 结果仅判 Permission.PLATFORM_ADMIN.value in platform_perms → allowed=None；否则走既有 allowed_workspace_ids（WORKSPACE_READ）
  - 改写端点 docstring 的 ql-20260917-007 段落：注明平台级 workspace:read 全量分支被本变更收窄，语义依据 D-001@v1（纯功能入口）
  - user.is_platform_admin 分支与 user_id 过滤逻辑不动
acceptance:
  - 非成员 + 平台级 workspace:read（无 platform:admin）→ GET /api/workspaces 返回空列表（FR-03）
  - 非成员 + 平台级 platform:admin → 全量列表（FR-02）
  - is_platform_admin → 全量列表 + user_id 筛选可用（不变）
  - 工作区成员 → 仅成员工作区（不变）
verify:
  - cd backend && .venv/Scripts/python -m pytest app/modules/workspace/tests/test_platform_grant_list.py -x -q
  - cd backend && .venv/Scripts/python -m ruff check app/modules/workspace/router.py && .venv/Scripts/python -m mypy app/modules/workspace/router.py
constraints:
  - 不改端点签名/查询参数/响应体（OpenAPI 零变化）
  - 断言反转归 task-04；本 task 只改实现与 docstring
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
