---
id: task-03
title: 'list_user_ids_with_permission 段 2 匹配权限收窄为仅 admin_perm（通知收件人对齐）'
title_zh: 'list_user_ids_with_permission 段 2 匹配权限收窄为仅 admin_perm（通知收件人对齐）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 18:03:09
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/auth/rbac.py
target_files:
  - backend/app/modules/auth/rbac.py
goal: >
  列表/内容/通知三口径对齐之二：list_user_ids_with_permission 段 2（平台级授予段）
  的权限匹配从 [target, admin_perm] 收窄为仅 [admin_perm]——工作区事件广播收件人
  = 成员（段 1）+ platform:admin 持有者（段 2）+ is_platform_admin 用户（段 3）。
implementation:
  - 改 backend/app/modules/auth/rbac.py:179-194 段 2 的 RolePermission.permission.in_([target, admin_perm]) → in_([admin_perm])
  - 同步改写段 2 注释与函数 docstring：平台级持 target 的非成员不再收工作区广播（对齐 has_permission 收紧后语义）
  - 段 1（工作区成员）、段 3（is_platform_admin）不动
acceptance:
  - 工作区 W 广播 permission=change:read 时：平台级仅持 change:read 的非成员不在收件人集合（FR-04）
  - 平台级持 platform:admin 的用户在收件人集合（不变语义）
  - W 的成员持 change:read 者仍在收件人集合（段 1 不变）
  - is_platform_admin 用户在收件人集合（段 3 不变）
verify:
  - cd backend && .venv/Scripts/python -m pytest app/modules/notification/tests/test_service.py -x -q
  - cd backend && .venv/Scripts/python -m ruff check app/modules/auth/rbac.py && .venv/Scripts/python -m mypy app/modules/auth/rbac.py
constraints:
  - 不改函数签名与三段结构
  - 与 task-01 同文件（rbac.py）——依赖 task-01 先落地，串行执行
  - 通知模块源码不动（消费方回归归 task-06）
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
