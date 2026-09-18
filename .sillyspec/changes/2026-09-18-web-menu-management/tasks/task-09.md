---
id: task-09
title: 'lib/menu-overrides.ts——useMenuOverrides（失败空覆盖直通）+ mergeMenus 纯函数（含 menus 豁免）'
title_zh: 'lib/menu-overrides.ts——useMenuOverrides（失败空覆盖直通）+ mergeMenus 纯函数（含 menus 豁免）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
provides:
  - contract: MergeMenusFn
    fields: [merge_menus_fn]
expects_from:
  task-07:
    - contract: ApiTypesPermissionUnion
      needs: [permission_union, menu_override_read]
allowed_paths:
  - frontend/src/lib/menu-overrides.ts
target_files:
  - NEW:frontend/src/lib/menu-overrides.ts
goal: >
  新建覆盖合并层（FR-05）——useMenuOverrides 用 TanStack Query 拉公开只读
  端点 GET /api/menu-overrides，拉取失败按空覆盖直通、不阻塞导航渲染；
  mergeMenus 纯函数把注册表与覆盖合并（label 覆盖/hidden 剔除且 menus
  恒豁免/组内稳定排序/孤儿忽略），供 app-shell（task-10）与菜单管理页
  （task-11）共用；注册表仍是目录单一数据源（D-001）。
implementation:
  - '文件头 docblock 声明三层管线定位（注册表代码不动 × permission.ts 权限过滤不动 × 本文件只做覆盖合并）；类型一律取 task-07 生成的 api-types（MenuOverrideRead 字段 menu_key/label_override/sort_order/hidden、MenuOverrideUpsert）'
  - 'fetchMenuOverrides()——apiFetch 拉 GET /api/menu-overrides 返回 items；导出 MENU_OVERRIDES_QUERY_KEY（本文件内联声明，管理页 PUT 成功后据此 invalidate 刷新导航，不进 lib/query-keys.ts 集中工厂，保持单文件交付面）'
  - 'useMenuOverrides()——useQuery 挂 MENU_OVERRIDES_QUERY_KEY + fetchMenuOverrides（staleTime 30s）；queryFn 抛错或首帧 isLoading 时 overrides 均按空数组返回——渲染层永不因覆盖接口故障抛错或空白（fallback 直通语义）'
  - mergeMenus(registry, overrides) 纯函数——按 menuKey 建 override Map 后逐 section 处理并返回新数组（不 mutate 入参）——1) label 取 override.label_override ?? menuLabel；2) hidden=true 行剔除，menuKey===menus 恒豁免不剔除（R-03 防自锁）；3) 组内按 sort_order ?? 声明序索引稳定排序（同值保声明序，section 间顺序不动）；4) 孤儿 override（registry 无此 menuKey）自然忽略；navHidden 过滤仍归渲染管线，本函数不重复处理
acceptance:
  - mergeMenus 对空覆盖（overrides 为空数组或全孤儿）直通返回，导航渲染与现状逐项一致（NFR-02 兼容基线）
  - label 覆盖生效、hidden=true 剔除、menus 行 hidden=true 仍保留、sort_order 组内重排且未覆盖行按声明序索引参与排序（断言面归 task-12 单测，本卡以 tsc + 实现自查）
  - useMenuOverrides 在接口 5xx/网络错误时返回空覆盖且不向渲染层抛错（导航 fallback 语义）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - mergeMenus 必须纯函数——不 mutate 入参、不触网络与 React 生命周期；单测文件（lib/__tests__/menu-overrides.test.ts）归 task-12，本卡不写测试
  - 只拉差异覆盖，不引入后端菜单目录拉取或本地持久化机制（D-001）；hidden 豁免仅 menus 一条（R-03）
  - 不改 permission.ts / app-shell.tsx / menu-permissions.ts（接入归 task-10，注册表归 task-08）
  - 类型只用 api-types 生成物，禁手写 MenuOverrideRead 重复接口
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
