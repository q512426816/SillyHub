---
id: task-07
title: theme-toggle.tsx 组件 + top-bar.tsx 接入（Palette 图标两态直切）（覆盖：FR-02, D-101@v1）
title_zh: theme-toggle.tsx 组件 + top-bar.tsx 接入（Palette 图标两态直切）（覆盖：FR-02, D-101@v1）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P1
depends_on: [task-04]
blocks: [task-14]
requirement_ids: [FR-02]
decision_ids: [D-101@v1]
allowed_paths:
  - frontend/src/components/theme-toggle.tsx
  - frontend/src/components/top-bar.tsx
expects_from:
  task-04:
    - contract: useThemeStore
      needs: [theme, setTheme]
goal: >
  新增顶栏主题切换按钮 theme-toggle.tsx 并接入 top-bar.tsx，实现 blue 与 ai-native
  两主题一键直切（Palette 图标两态），偏好经 store persist 记忆（design §5 P1 / §6）。
implementation:
  - 新建 components/theme-toggle.tsx 客户端组件，从 useThemeStore 取 theme 与 setTheme
  - lucide Palette 图标按钮两态直切，当前为 ai-native 时点击切 blue，当前为 blue 时切回 ai-native，不做下拉
  - title 与 aria-label 用中文提示当前主题与切换目标，键盘可聚焦可触发
  - top-bar.tsx 右侧操作区在通知铃与用户菜单之间插入 ThemeToggle 节点
  - 按钮沿用顶栏既有图标钮规格（尺寸圆角与 hover 态一致），配色用语义类不写死蓝
acceptance:
  - 点击后 antd token 与 CSS 变量全站即时切换到目标主题
  - 刷新页面偏好保持（localStorage 的 sillyhub-theme）
  - 按钮位于通知铃与用户菜单之间，两主题下自身配色均正确
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/theme-toggle.tsx src/components/top-bar.tsx
constraints:
  - 仅两态直切，不做下拉菜单与第三主题（design §3 非目标）
  - 不直接读写 localStorage，切换一律经 setTheme 走 store persist
  - 不改 top-bar 既有面包屑、搜索、通知、用户菜单逻辑，仅插入一个节点
  - 本卡不动 antd-providers.tsx、globals.css、layout.tsx（各归 task-05、task-02、task-06）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
