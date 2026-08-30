---
id: task-15
title: 总验收——grep 复核品牌蓝清零（`bg-blue|text-blue|border-blue|#2563eb|#3b82f6|rgba(22, 119, 255`，信息语义逐一判断）/ tsc+eslint 0 error / `pnpm test` 全绿 / Docker rebuild 两主题核心页截图对照原型 + blue 逐页对照重构前截图（info 档除外）/ FRONTEND_PAGE_STYLE.md §7 与 scan 文档同步（覆盖：FR-04, FR-06, 全部 D）
title_zh: 总验收——grep 复核品牌蓝清零（`bg-blue|text-blue|border-blue|#2563eb|#3b82f6|rgba(22, 119, 255`，信息语义逐一判断）/ tsc+eslint 0 error / `pnpm test` 全绿 / Docker rebuild 两主题核心页截图对照原型 + blue 逐页对照重构前截图（info 档除外）/ FRONTEND_PAGE_STYLE.md §7 与 scan 文档同步（覆盖：FR-04, FR-06, 全部 D）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-14]
blocks: []
requirement_ids: [FR-04, FR-06]
decision_ids: [D-101@v1, D-102@v1, D-003@v2, D-004@v1]
allowed_paths:
  - frontend/src/styles/themes.ts
  - frontend/src/app/globals.css
  - .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
  - .sillyspec/changes/2026-08-20-frontend-ai-native-style/design.md
  - docs/ui-redesign-ai-native-prototype-2026-08-20.html
goal: >
  全局总验收——按 plan 七条验收标准逐项收齐证据（品牌蓝清零/质量门/Docker 两主题截图对照/
  文档同步），确认 AI-Native 重构达到可收尾状态。
implementation:
  - grep 复核品牌蓝清零——frontend/src 全量扫六类模式 bg-blue、text-blue、border-blue、#2563eb、#3b82f6、rgba(22, 119, 255（rgba 为含空格写法需整体匹配）
  - 命中残留逐一判断并列表化留档——真实信息语义场景（如 info 提示/链接语义）放行，品牌用途残留必须为零（R-01）
  - 质量门——tsc --noEmit 与 eslint 均 0 error；pnpm test 全绿（含 task-14 新增单测）
  - Docker rebuild 前端服务后重启（不靠热更，R-06）——两主题各截工作区/会话/PPM 表格/登录/kanban 五核心页，对照本变更目录原型 prototype-frontend-ai-native-style.html
  - blue 主题对照口径（design §9）——逐页对照重构前同页截图，主色/选中态/表格头/卡片边框/按钮/徽章色逐项核对，info 徽标档除外（D-003@v2 例外）
  - 实测切换与持久化——ThemeToggle 两态切换全站即时生效、刷新保持偏好、首帧无闪烁（R-03）；确认回退路径可行（不渲染开关+DEFAULT_THEME 改 blue）
  - 文档同步——FRONTEND_PAGE_STYLE.md §7 补 info 档两主题统一青的例外说明；scan 相关文档同步 brand 语义阶与主题机制
  - design.md 三处措辞修正（brainstorm 记录的 plan 顺手项）——§9 info 例外统一为 colorInfo#2563eb 口径、R-05 grep 方向修正、palette.brand 统一为 color.brand
acceptance:
  - grep 六类模式品牌用途命中为零，信息语义残留逐条判断并列表留档
  - tsc 与 eslint 0 error 且 pnpm test 全绿
  - Docker rebuild 后两主题五核心页截图对照原型通过；blue 主题逐页对照重构前截图一致（info 档除外）
  - FRONTEND_PAGE_STYLE.md §7、scan 文档与 design.md 措辞同步完成
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
  - cd frontend && pnpm test
  - cd frontend && grep -rnE `bg-blue|text-blue|border-blue` src；另逐个扫 `#2563eb`、`#3b82f6`、`rgba(22, 119, 255`（含空格模式整体需引号包裹）
  - docker compose -f deploy/docker-compose.yml build frontend && docker compose -f deploy/docker-compose.yml up -d frontend，浏览器两主题截图核心五页对照原型与重构前基线
constraints:
  - Docker 截图阶段不热更需 rebuild 后实测，不只靠 tsc（R-06）
  - blue 对照基线=重构前同页截图（git 历史检出或重构前提前截图存档），不新造基线、不做像素级 diff
  - 不新增第三主题；原型 html 与评审 html 仅只读对照不修改
  - 纯验收+文档——除文档与 design 措辞外不改业务代码，发现问题回对应任务修复
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
