---
id: task-05
title: '菜单注册——menu-permissions.ts governance 组新增 deploy-records 项 + app-shell MENU_ICON_MAP（History 图标）+ admin/menus 测试断言锚重算'
title_zh: '菜单注册——menu-permissions.ts governance 组新增 deploy-records 项 + app-shell MENU_ICON_MAP（History 图标）+ admin/menus 测试断言锚重算'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:04:08
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/components/app-shell.tsx
  - frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
  - frontend/src/lib/__tests__/menu-permissions.test.ts
  - frontend/src/lib/__tests__/permission.test.ts
  - frontend/src/components/__tests__/admin-role-permission-picker-tree.test.tsx
target_files:
  - frontend/src/components/__tests__/app-shell.test.tsx
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/components/app-shell.tsx
  - frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
goal: >
  侧边栏「协作治理」组注册「发布记录」菜单（absolute /deploy-records，
  deploy_record:read 门控），History 图标，断言面⑦测试锚同提交重算。
expects_from:
  - contract: deploy_record:read 权限 key
    needs: [deploy_record:read]
  - contract: /deploy-records 路由页面
    needs: [page.tsx]
implementation:
  - frontend/src/lib/menu-permissions.ts：MENU_PERMISSION_GROUPS governance 组（incidents 后）新增 deploy-records 菜单项（menuKey 字符串 deploy-records、menuLabel 发布记录、icon 📦、href 与 matchPattern 均为 /deploy-records、absolute true、permissions 挂 key 为 deploy_record:read 名为 发布记录查看 的单项）
  - frontend/src/components/app-shell.tsx：MENU_ICON_MAP 增 "/deploy-records": History（lucide import；Package 已被 releases 占用）
  - 断言面⑦：frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx 组内上移/下移声明序锚按新注册表位置重算（menu-permissions.ts:97-100 注释规约，scripts/check-assertion-surfaces.py 门禁）
  - 排查其余直接消费 MENU_PERMISSION_GROUPS 的测试（menu-permissions.test.ts / permission.test.ts / admin-role-permission-picker-tree.test.tsx / top-bar.test.tsx）是否断言菜单数/序，失效则同步修
acceptance:
  - 登录持权用户侧边栏协作治理组可见「发布记录」并可跳 /deploy-records
  - node scripts/check-assertion-surfaces.py 通过
  - 受牵连测试全部同步修好（无跳过无注释绕过）
verify:
  - cd frontend && pnpm test -- menus page
  - node scripts/check-assertion-surfaces.py
constraints:
  - menuKey 稳定标识规约：只新增条目，不重命名不复用既有 key（R-01 注释规约）
  - 不动 MENU_SECTION_ORDER/LABEL（governance 组已存在）
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
