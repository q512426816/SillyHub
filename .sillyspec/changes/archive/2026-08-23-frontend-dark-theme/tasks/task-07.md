---
id: task-07
title: 'upgrade theme toggle to three-option dropdown'
title_zh: 'theme-toggle.tsx 升级三选一下拉'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: ['task-01']
blocks: []
expects_from:
  task-01:
    - contract: themes
      needs: [dark]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/theme-toggle.tsx
goal: >
  Palette 图标钮由两态直切升级为 antd Dropdown 三选一菜单（AI紫/明亮蓝/暗夜），
  items 由 themes 注册表派生、当前项高亮勾选，点击 setTheme 即时全站换肤，
  刷新经 persist 记忆（FR-02、D-001@v1、design §5.2）。
implementation:
  - 菜单 items 由 themes 注册表派生（label 加品牌色小方块，顺序 ai-native/blue/dark），禁止硬编码第三处主题清单
  - 当前主题项高亮勾选；菜单项 onClick 调 setTheme 即时换肤（antd token 与 CSS 变量半边走既有联动）
  - 触发器沿用顶栏图标钮规格（h-9 w-9 Palette、hover 与通知铃一致），aria-label 保留并带当前主题名
  - 文件头注释由两态直切改为三选一口径，追溯 FR-02 / D-001@v1
acceptance:
  - 点击弹出三项菜单且当前项高亮；选择任一项全站即时换肤无 reload（FR-02）
  - 刷新后记忆生效（经 store persist，本组件不直读写 localStorage）
  - 菜单键盘可达（方向键与回车选择），aria-label 语义正确
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 不直接读写 localStorage，一律经 useThemeStore
  - 沿用顶栏图标钮规格，不改尺寸/圆角/hover 类名
  - 不做 blue 暗色版等第四主题入口（design §3 非目标）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
