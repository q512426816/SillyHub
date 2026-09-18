---
id: task-12
title: 'add-frontend-tests-and-sync-assertions'
title_zh: '前端测试（merge 纯函数单测 + 管理页交互测试 + permission.test 与 menu-permissions.test 断言同步）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-10', 'task-11']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/__tests__/
  - frontend/src/app/(dashboard)/admin/menus/__tests__/
target_files:
  - NEW:frontend/src/lib/__tests__/menu-overrides.test.ts
  - NEW:frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
  - frontend/src/lib/__tests__/permission.test.ts
  - frontend/src/lib/__tests__/menu-permissions.test.ts
related_tests:
  - frontend/src/lib/__tests__/permission.test.ts - task-08 给 system 段新增 menus 菜单项后 FR-06 用例3 平台管理员全量清单（行229-241 期望恰 4 项）确定性失效需补 menus
  - frontend/src/lib/__tests__/menu-permissions.test.ts - task-08 注册表更新致四类断言确定性失效（EXPECTED_MENU_KEYS 严格清单、4 菜单空 permissions 例外块、skills 与 mcp 的 pickerHidden 为真、BACKEND_PERMISSION_KEYS 镜像缺 5 新 key）
goal: >
  为 task-09 的 mergeMenus 纯函数与 task-11 的 /admin/menus 管理页补前端测试，
  并同步 task-08 注册表更新（4 菜单补权限 + 新增 menus 项）导致的 permission.test
  与 menu-permissions.test 既有断言失效，守住 FR-01/02/03/05 行为不回归。
implementation:
  - 新建 frontend/src/lib/__tests__/menu-overrides.test.ts——mergeMenus 纯函数六类用例：label 覆盖生效（label_override 替换 menuLabel，null 直通默认名）；hidden 为真剔除该行；menus 豁免（menuKey 为 menus 时 hidden 恒忽略不剔除，R-03 防自锁）；组内排序（sort_order 缺省回落声明序索引，稳定排序不打乱同序相对位置）；孤儿 override（registry 无此 menuKey）静默忽略；空覆盖数组输入输出与 registry 逐项全等（NFR-02 直通语义）
  - 新建 frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx——脚手架照搬 admin/organizations/__tests__/page.test.tsx 惯例（AntApp 包裹满足 useNotify 的 App.useApp 上下文、vi.hoisted 加 vi.mock 数据层、useSession.setState 注入会话、afterEach 复位 session 与 clearAllMocks）
  - 页面交互用例——行内改名保存（编辑显示名后触发 PUT 且出现已改名标记）与恢复默认、组内上移下移（断言 PUT sort_order）、隐藏开关（menus 行 Switch disabled 带锁提示，普通行切换触发 PUT hidden）
  - 权限区用例——展开挂载权限明细（key 加中文名加持有角色 chips，角色来自 mock 的 GET /api/admin/roles 客户端反查 D-003）；role:read 403 降级（mock roles 请求 reject 403 时角色区渲染需 role:read 查看角色分布占位，改名/排序/隐藏主功能不受阻，R-08）
  - 同步 menu-permissions.test.ts 四类失效断言——EXPECTED_MENU_KEYS 加 menus（连带长度 37 到 38 与 system 分布 4 到 5 两处计数断言）；行196-223 的 skills/agent-profiles/sessions/mcp 空 permissions 例外块改为断言各自新 key（skill:read、agent_profile:read、agent_session:read、mcp:read）；行235-249 与行351-376 的 skills 与 mcp pickerHidden 为真断言改为 pickerHidden 假且 permissions 命中新 key；BACKEND_PERMISSION_KEYS 镜像常量补 5 个新 key（含 menu:admin）并同步其长度断言
  - 同步 permission.test.ts——FR-06 用例3 平台管理员 system 段全量清单补 menus；空 permissions 可见性语义用例走 mockGroup 构造不依赖注册表实貌，跑测确认不误改
acceptance:
  - cd frontend 后 vitest run 四个相关测试文件全绿（menu-overrides.test.ts、menus 下 page.test.tsx、permission.test.ts、menu-permissions.test.ts）
  - mergeMenus 单测覆盖六类纯函数行为（label 覆盖/hidden 剔除/menus 豁免/组内排序/孤儿忽略/空覆盖直通）且不触网络与 React
  - 页面测试覆盖行内改名保存、上移下移、隐藏开关（menus 行 disabled）、权限展开含持有角色、role:read 403 降级占位五类交互
  - 断言同步只更新因注册表数据变化的期望值（清单/计数/key 集合），不弱化或删除断言语义
verify:
  - cd frontend && pnpm exec vitest run src/lib/__tests__/menu-overrides.test.ts src/lib/__tests__/permission.test.ts src/lib/__tests__/menu-permissions.test.ts menus/__tests__/page.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 禁跑全量测试仅跑上述相关文件（CLAUDE.md 规则 0，全量留给 CI）
  - 非测试逻辑本身有误时禁止改测试凑通过（CLAUDE.md 规则 9）——本卡仅允许同步 task-08 注册表数据变化导致的确定性失效期望值
  - 不改生产代码（menu-permissions.ts、menu-overrides.ts、管理页 page.tsx 等）——发现实现缺陷回流 task-08/09/10/11 修复后重跑
  - 页面测试沿用既有 vitest 加 testing-library 加 AntApp 脚手架不引入新测试依赖；测试注释用中文对齐 organizations 页测惯例
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
