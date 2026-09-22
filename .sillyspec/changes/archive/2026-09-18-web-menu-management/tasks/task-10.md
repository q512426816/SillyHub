---
id: task-10
title: 'app-shell 渲染经 mergeMenus + 图标映射补 /admin/menus'
title_zh: 'app-shell 渲染经 mergeMenus + 图标映射补 /admin/menus'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-08', 'task-09']
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-001@v1]
expects_from:
  task-08:
    - contract: MenuRegistryUpdate
      needs: [menus_entry]
  task-09:
    - contract: MergeMenusFn
      needs: [merge_menus_fn]
allowed_paths:
  - frontend/src/components/app-shell.tsx
target_files:
  - frontend/src/components/app-shell.tsx
goal: >
  侧边栏渲染管线接入覆盖合并（FR-05 落地）——权限过滤结果经 mergeMenus
  应用全局覆盖（改名/隐藏/组内排序），MENU_ICON_MAP 补 /admin/menus 让
  task-08 的 menus 入口可渲染（FR-01 收口）；空覆盖/覆盖未到位时渲染与
  现状逐项一致（NFR-02）。
implementation:
  - 'import { useMenuOverrides, mergeMenus } from "@/lib/menu-overrides"（task-09 契约）；AppShell 内取 overrides = useMenuOverrides().overrides'
  - sidebarSections 管线（app-shell.tsx:234-241）在 visibleMenusBySection(user, section) 结果上套 mergeMenus 后再走既有 navHidden 过滤——权限过滤与覆盖合并两维度独立，顺序先权限后合并（design 接口定义注释）
  - hidden 剔除与 menus 恒豁免已在 mergeMenus 内完成，本文件不写任何豁免/隐藏特判；resolveHref/matchLength/isActive 最长匹配高亮逻辑零改动
  - 'MENU_ICON_MAP（:71-126）补 "/admin/menus" 条目——lucide 取未被占用的菜单语义图标（如 ListTree），注释风格对齐相邻 admin 条目'
acceptance:
  - 未配置覆盖时侧边栏与接入前逐项一致；PUT 改名/排序/隐藏后导航随之变化（label 更新、组内重排、hidden 行消失）
  - menus 行即使被覆盖 hidden=true 仍在侧边栏渲染（豁免在合并层，本文件无特判代码）；持 menu:admin 用户侧边栏出现「菜单管理」入口且图标命中 MENU_ICON_MAP 非 fallback Circle
  - /admin/menus 路径高亮按 matchPattern=/admin/menus 正常命中（最长匹配独占逻辑未改动）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只改 app-shell.tsx；不动 permission.ts、mobile/mobile-app-shell.tsx（design 非目标：移动端导航不纳管）
  - 不在渲染层重复 hidden/豁免/排序逻辑（单一归属 mergeMenus）；不改既有高亮/折叠/工作区前缀语义
  - 相关测试同步归 task-12，本卡不改测试文件；UI 文案中文
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
