---
id: task-04
title: 'Register server-status menu and rebake assertion anchors'
title_zh: '菜单注册与锚重算——system 组新增 server-status + Server 图标 + admin/menus 断言 5→6 行与锚注释重算 + 聚焦回归'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 00:21:05
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/components/app-shell.tsx
  - frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
target_files:
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/components/app-shell.tsx
  - frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
expects_from:
  task-02:
    - contract: ServerStatusPage
      needs: [route /admin/server-status 可达]
  task-03:
    - contract: PermissionKey
      needs: [system_status:read]
goal: >
  把服务器信息页接入导航：system 组末尾注册 server-status 菜单（system_status:read 门控）+
  侧边栏 Server 图标，同步重算 admin/menus 测试断言锚（共享断言面⑦合规），跑聚焦回归收口。
implementation:
  - frontend/src/lib/menu-permissions.ts system 组末尾（menus 条目之后、ppm 组之前）新增条目——menuKey=server-status / menuLabel=服务器信息 / icon 占位 emoji / href=/admin/server-status / absolute=true / matchPattern=/admin/server-status / permissions=[{key=system_status:read, name=服务器状态查看}]（menuKey 遵守 R-01 稳定标识规约禁止复用）
  - frontend/src/components/app-shell.tsx lucide import 加 Server，MENU_ICON_MAP 增 "/admin/server-status"= Server（注释注明 2026-10-14-admin-server-status；map 内无占用，daemon 机器卡的跨文件复用不冲突）
  - frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx 断言「system 组 5 行」改 6 行（:161-168 一带）；上移/下移用例声明序锚注释更新（:224-226 一带——users=18/org=19/roles=20 不变，注释补「server-status 第 23 条后插使 ppm 组索引 +1」；PUT 值 19/20 无需改，实测无 ppm 索引断言）
  - 聚焦回归：后端 test_health + 前端新页面/admin-menus 测试全绿 + tsc --noEmit + eslint 零错；提交前本地跑 python scripts/check-assertion-surfaces.py（R-02 应对）
acceptance:
  - 系统管理组渲染 6 项菜单，持 system_status:read 或 platform:admin 可见「服务器信息」并进入 /admin/server-status
  - admin/menus 测试通过（6 行断言 + 声明序锚注释一致）
  - 聚焦测试全绿：backend test_health + frontend server-status 页面 + admin/menus；tsc 与 eslint 零错
  - scripts/check-assertion-surfaces.py 无新增告警
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/admin" --no-coverage
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
  - cd backend && uv run pytest tests/test_health.py -q --no-cov
constraints:
  - menuKey=server-status 禁止重命名或复用（R-01）
  - 不动其它菜单条目与 ppm 组内容
  - 共享断言面⑦：本注册表增删条目与 admin/menus 测试锚重算必须同一提交
related_tests:
  - path: frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
    reason: system 组 5 行断言与声明序锚注释因新增第 6 条菜单失效，需同步重算
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
