---
id: task-06
title: app/layout.tsx 防闪烁 inline script（首帧前读 localStorage 设 data-theme，兜底 ai-native）（覆盖：FR-02, D-102@v1）
title_zh: app/layout.tsx 防闪烁 inline script（首帧前读 localStorage 设 data-theme，兜底 ai-native）（覆盖：FR-02, D-102@v1）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P1
depends_on: [task-02]
blocks: [task-14]
requirement_ids: [FR-02]
decision_ids: [D-102@v1]
allowed_paths:
  - frontend/src/app/layout.tsx
expects_from:
  task-04:
    - contract: useThemeStore
      needs: [theme, setTheme]
goal: >
  在 app/layout.tsx 注入防闪烁 inline script，首帧渲染前读 localStorage 主题偏好并设置
  html 的 data-theme，消除 SSR 首帧主题闪烁（design §10 R-03），CSS 变量侧首帧即命中正确主题。
implementation:
  - 在 html 开标签之后 body 之前插入同步立即执行的 script 标签，纯内联无任何模块导入
  - 脚本逻辑为读取 localStorage 的 sillyhub-theme 键，值合法（blue 或 ai-native）则写入 documentElement 的 data-theme 属性
  - 值缺失或非法时兜底设为 ai-native，与 store 的 DEFAULT_THEME 兜底口径一致
  - 脚本必须在首次绘制前同步执行完毕，保证 task-02 双套 CSS 变量块首帧命中
acceptance:
  - 首帧前 html 已带正确 data-theme，未设偏好或非法值时为 ai-native
  - 设 blue 偏好后刷新页面首帧即蓝主题，无先紫后蓝闪烁
  - html 保留 suppressHydrationWarning，无 hydration 报错
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/app/layout.tsx
constraints:
  - inline script 不经 useThemeStore（首帧前 store 尚未 hydrate，直读 localStorage），仅要求与 store 持久化 key 一致（sillyhub-theme）
  - 兜底逻辑与 store 一致，非法值或缺失一律回落 ai-native
  - 不改 AntdProviders 与 AppProviders 嵌套结构，不动 globals.css 引入与 metadata
  - 不做暗色模式分支（.dark 预留不动，design §3 非目标）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
