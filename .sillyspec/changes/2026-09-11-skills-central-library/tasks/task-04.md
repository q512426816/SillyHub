---
id: task-04
title: 'skills settings page source management and library toggle sections with generated types'
title_zh: '技能设置页两新区块——源管理（admin）/技能库启用开关+gen:types 双仓+模块卡'
author: 'qinyi'
created_at: 2026-09-11 02:18:41
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002, D-003]
allowed_paths:
  - frontend/src/app/(dashboard)/settings/skills/
  - frontend/src/components/skills-library/
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
  - .sillyspec/docs/backend/modules/
target_files:
  - frontend/src/app/(dashboard)/settings/skills/page.tsx
  - frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx
  - NEW:frontend/src/components/skills-library/source-manage-card.tsx
  - NEW:frontend/src/components/skills-library/library-enable-list.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
  - NEW:.sillyspec/docs/backend/modules/skill_source.md
library/enable 端点 + bundle 第三源收集
      needs: [GET /api/skills/library LibraryView, 'POST+DELETE /api/skills/{skill_key}/enable 本人写']
goal: >
  设置技能页升级两新区块——「技能源管理」（admin 门控，源 CRUD+手动刷新+last_commit/
  last_error 状态展示）与「技能库」（三源聚合列表+逐技能启用开关，D-003 默认关）；
  「我的技能」现状区块零改动；gen:types 双仓同步 + skill_source 模块卡落盘（FR-04 收尾）。
implementation:
  - 'gen:types 先行——task-01/03 后端 schema 定稿后跑 pnpm -C frontend gen:types 与 pnpm -C sillyhub-daemon gen:types，api-types.ts/openapi.json 双仓零漂移并随卡提交（CLAUDE.md 规则 21，禁手写类型；node_modules 健康先 pnpm exec tsc --version 确认）'
  - 'skills-library 组件——source-manage-card.tsx（admin 源列表+新建/编辑/删除/手动刷新+last_commit/last_error 状态徽标）与 library-enable-list.tsx（三源分组技能列表+启用 Switch，toggle 调 POST/DELETE enable 乐观更新失败回滚）；React Query hooks 共置同目录（照 custom-skills.ts apiFetch+queryKeys 先例，不新增 lib 文件）'
  - 'page.tsx 升级——插入两新区块（源管理按 is_platform_admin 门控；技能库全员可见），「我的技能」区块与 custom-skill 既有交互零改动；样式走 brand-* 语义阶+主题 token+antd ConfigProvider（FRONTEND_PAGE_STYLE.md §0.5 多主题铁律），UI 文案中文（CLAUDE.md 规则 12）'
  - '__tests__ 扩展——page.test.tsx 新增 describe（admin 见源管理/非 admin 不见；技能库分组渲染+开关乐观回滚+成功后失效刷新 manifest）；skills-library/__tests__ 组件级用例（mock apiFetch 断言请求路径与方法）'
  - '模块卡——.sillyspec/docs/backend/modules/skill_source.md（照 modules/skills.md 惯例）+ _module-map.yaml 登记新模块（路径已在 allowed_paths）'
acceptance:
  - '源管理区块仅 admin 可见可操作；技能库区块全员可见、git 技能默认未启用（D-003）'
  - '启用开关正确调 POST/DELETE enable、乐观更新失败回滚；「我的技能」既有用例零回归'
  - 'pnpm gen:types:check 双仓零漂移，api-types.ts/openapi.json 无手写改动痕迹'
  - 'skill_source.md 模块卡落盘并登记 _module-map.yaml'
verify:
  - 'pnpm -C frontend exec tsc --noEmit'
  - 'pnpm -C frontend exec vitest run "src/app/(dashboard)/settings/skills" src/components/skills-library（新增+既有全绿，不跑全量）'
  - 'pnpm -C frontend gen:types:check && pnpm -C sillyhub-daemon gen:types:check'
  - 'pnpm -C frontend exec eslint "src/app/(dashboard)/settings/skills" src/components/skills-library'
constraints:
  - '「我的技能」现状区块与 custom-skill 交互零改动（design 文件清单「我的技能现状不动」）'
  - '本卡不改后端 schema，只消费 task-01/03 定稿 DTO；api-types.ts 一律 gen:types 产物禁手写'
  - '多主题铁律——取值单一源 themes.ts、brand-* 语义阶、blue-* 仅真信息蓝、阴影走 shadow-* token'
  - '不跑全量测试（CLAUDE.md 规则 0）；组件/hooks 文件名照仓内 kebab-case 惯例'
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
