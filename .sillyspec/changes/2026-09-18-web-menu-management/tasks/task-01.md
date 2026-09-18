---
id: task-01
title: 'add-permission-enum-entries-and-group-prefix-mapping'
title_zh: '后端 Permission 枚举新增 5 项 + group 前缀映射（skill/mcp/agent_profile/agent_session→AGENT）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/auth/permissions.py
  - backend/tests/modules/auth/test_permissions.py
target_files:
  - backend/app/modules/auth/permissions.py
  - backend/tests/modules/auth/test_permissions.py
provides:
  - contract Permission 四个菜单读权限枚举成员 SKILL_READ、MCP_READ、AGENT_PROFILE_READ、AGENT_SESSION_READ（字符串值 skill:read、mcp:read、agent_profile:read、agent_session:read，供 task-03 种子迁移消费）
  - contract Permission 菜单管理门控枚举成员 MENU_ADMIN（字符串值 menu:admin，供 task-05 路由门控消费）
related_tests:
  - backend/tests/modules/auth/test_permissions.py
goal: >
  在 Permission 枚举纯增量新增 5 个菜单权限成员并补 group 前缀映射，为 4 个常显菜单按角色开关与菜单管理页门控提供权限地基。
implementation:
  - 在 Permission 枚举按既有分段注释惯例新增成员 SKILL_READ、MCP_READ、AGENT_PROFILE_READ、AGENT_SESSION_READ、MENU_ADMIN，附 change 来源注释
  - 在 group 属性前缀映射把 skill、mcp、agent_profile、agent_session 四个前缀归入 PermissionGroup.AGENT
  - menu 前缀不加显式分支，走默认返回 PermissionGroup.PLATFORM
  - 同步 test_permissions.py 确定性失效断言，计数 67 改 72，补 5 条 group 解析与字符串值断言
acceptance:
  - 5 个新成员字符串值分别为 skill:read、mcp:read、agent_profile:read、agent_session:read、menu:admin，既有 67 项枚举值逐一不变
  - group 解析 4 个新 read 权限返回 AGENT 组，MENU_ADMIN 返回 PLATFORM 组
  - test_permissions.py 全绿，ruff 与 mypy scoped 零报错
verify:
  - cd backend && uv run pytest tests/modules/auth/test_permissions.py
  - cd backend && uv run ruff check app/modules/auth/permissions.py tests/modules/auth/test_permissions.py
  - cd backend && uv run mypy app/modules/auth/permissions.py
constraints:
  - 纯增量，不修改或删除任何既有枚举成员与既有前缀映射分支
  - group 映射仅维护后端目录归类一致性，不新增消费方（前端角色勾选器折叠由前端注册表 section 驱动）
  - 权限字符串值须与 task-03 迁移内硬编码字面量逐字一致（由测试断言对齐）
  - 代码兼容 Windows、Linux 和 macOS
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
