---
id: task-04
title: 'extend theme store merge to follow prefers-color-scheme'
title_zh: 'stores/theme.ts merge 扩展（无记录时跟随 prefers-color-scheme）'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: ['task-01']
blocks: []
expects_from:
  task-01:
    - contract: ThemeName
      needs: [dark]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/stores/theme.ts
goal: >
  merge 扩展为三分支——persisted.theme 为 undefined（localStorage 无记录，
  用户从未选择）时读 matchMedia 的 prefers-color-scheme dark 匹配决定初始主题
  （命中则 dark，否则 DEFAULT_THEME），防止 React 水合后 useEffect 把 layout
  脚本判出的 dark 覆盖回默认；透传与非法值兜底口径不变（design §5.2/§7/§9）。
implementation:
  - merge 三分支化——persisted.theme 为 undefined 时经 window.matchMedia 读 prefers-color-scheme dark 匹配，命中置 dark，否则 DEFAULT_THEME
  - 合法值（blue/ai-native/dark）透传、非法值回退 DEFAULT_THEME 两分支保持现状口径
  - matchMedia 做存在性与异常保护，不可用或抛错一律回落 DEFAULT_THEME（与 layout 脚本 R-06 兜底成对）
  - 文件头与 merge 处注释同步无记录跟随系统新口径，追溯 FR-03 / D-002@v1
acceptance:
  - 无记录且系统暗色时水合后 store.theme 为 dark，首帧脚本判定的 data-theme 不被覆盖回 ai-native（FR-03）
  - 无记录且系统浅色时 theme 为 DEFAULT_THEME；已持久化合法值行为与现状完全一致
  - 非法持久化值仍回退 DEFAULT_THEME；matchMedia 不可用或异常回落 ai-native
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/stores/theme.test.ts
constraints:
  - SSR 安全——matchMedia 仅在客户端 persist 水合的 merge 内访问，禁止模块顶层调用；不引入 prefers-color-scheme change 监听（design §3 非目标）
  - ThemeState 签名（theme/setTheme）与 persist 键名、存储格式不变（design §7）
  - 不新增或修改测试文件（跟随系统单测与存量断言口径更新归 task-10）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
