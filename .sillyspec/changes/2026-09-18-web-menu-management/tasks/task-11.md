---
id: task-11
title: '/admin/menus 管理页（对照原型：分组表格/行内改名/上移下移/隐藏开关/权限+持有角色展开/role:read 降级）'
title_zh: '/admin/menus 管理页（对照原型：分组表格/行内改名/上移下移/隐藏开关/权限+持有角色展开/role:read 降级）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@v1, D-003@v1]
expects_from:
  task-07:
    - contract: ApiTypesPermissionUnion
      needs: [permission_union, menu_override_read]
  task-08:
    - contract: MenuRegistryUpdate
      needs: [menus_entry]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/menus/
target_files:
  - NEW:frontend/src/app/(dashboard)/admin/menus/page.tsx
goal: >
  新建菜单管理页 /admin/menus（入口由 task-08 注册表 menu:admin 门控，
  对照原型 prototype-menu-admin.html）——antd Table 按 MENU_SECTION_ORDER
  分组展示注册表菜单，行内改名+恢复默认、组内上移下移、全局隐藏开关
  （menus 行 disabled）行级即时 PUT 保存，权限与持有角色只读展开
  （roles 客户端反查，缺 role:read 优雅降级 R-08）——FR-02/FR-03，
  D-002 全局生效、D-003 只读反查。
implementation:
  - 页面骨架对齐 admin/roles 页与 FRONTEND_PAGE_STYLE（PageContainer/PageHeader + §4 DataTable）——rowKey=menuKey、不分页（全量约 38 行）、按 MENU_SECTION_ORDER 为每组插分组标题行（原型 section-row 语义）；页头说明条明示「隐藏=全局下架（含平台管理员），按角色开关请前往角色管理页」（R-05 边界）
  - 数据源——useMenuOverrides()（task-09）建 menuKey→覆盖 Map（label/sort_order/hidden 当前值与「已改名」标记）；持有角色用 lib/admin 既有 listRoles()（GET /api/admin/roles）客户端反查权限 key→角色名列表——注意 RoleRead 响应字段名是 permissions 而非 permission_keys（D-003）；listRoles 失败（403 等）时角色 chips 区整体降级为「需 role:read 查看角色分布」占位（R-08），不阻塞其余功能
  - 列定义——排序列组内上移/下移按钮（组首/组尾 disabled）；菜单列默认名+路由小字；显示名列行内编辑（回车/失焦提交）+「已改名」标记+恢复默认（清 label 覆盖）；全局隐藏列 Switch，menus 行 disabled 加「自身不可隐藏」锁提示（R-03）；挂载权限列前 2 个 key 摘要，展开行列权限 key+中文名+持有角色 chips+「分配请前往角色管理」提示
  - 保存——每次操作一次 PUT /api/menu-overrides/{menu_key}（apiFetch 传 MenuOverrideUpsert 局部字段，清除项传 null 回默认）；成功行内 toast 并失效 MENU_OVERRIDES_QUERY_KEY（导航即时生效），失败 toast 留重试入口；无整页保存按钮（行级即时保存）
  - 上移下移——目标行与相邻行交换生效 sort_order，两行各 PUT 一次覆盖值（未覆盖行以组内声明序索引为当前值），多次移动稳定收敛
acceptance:
  - 改名/恢复默认/上移下移/隐藏开关每次操作各发一次 PUT，成功后菜单覆盖缓存失效导航随之更新；menus 行不存在 PUT hidden=true 的路径
  - 权限展开区纯只读——无任何修改权限的交互；角色 chips 数据来自 roles[].permissions 反查，无新后端聚合端点
  - 无 role:read 时角色 chips 区显示降级占位，改名/排序/隐藏不受影响；/admin/menus 在 AppShell 布局内可达
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 权限区只读铁律（D-003）——只消费既有 GET /api/admin/roles（响应字段 permissions 非 permission_keys），不改权限、不新增聚合端点
  - 覆盖全局生效（D-002）——页面不做角色维度过滤，menus 行隐藏 disabled（R-03）；行级最后写赢接受（R-04）
  - 只读消费 menu-permissions.ts 与 menu-overrides.ts（归属 task-08/task-09，本卡不改）；UI 全中文，antd Table 惯例对齐 FRONTEND_PAGE_STYLE §4
  - 页面交互测试（__tests__/page.test.tsx）归 task-12，本卡不写测试
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
