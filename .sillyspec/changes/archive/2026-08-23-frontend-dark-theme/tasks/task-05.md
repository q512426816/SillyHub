---
id: task-05
title: 'extend layout anti-flash script for dark value and system preference'
title_zh: 'layout.tsx 防闪烁脚本扩展（合法值加 dark + 无记录跟随系统）'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: ['task-01']
blocks: []
expects_from:
  task-01:
    - contract: ThemeName
      needs: [dark]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/app/layout.tsx
goal: >
  防闪烁 inline script 合法值白名单扩为 blue 与 dark，且 savedTheme 为 null
  （无记录）时同样经 matchMedia 的 prefers-color-scheme 判定首帧主题，与
  store merge 口径成对一致，保证系统暗色新用户首帧 data-theme 即为 dark
  （design §5.2/§6 成对要求）。
implementation:
  - themeInitScript 白名单扩两分支——savedTheme 为 blue 或 dark 时直取记录值
  - savedTheme 为 null（无记录）时读 matchMedia 的 prefers-color-scheme dark 匹配，命中置 dark，否则保持 ai-native
  - matchMedia 调用包进既有 try-catch，异常或不可用回落 ai-native（R-06、FR-03 兜底）
  - 脚本上方注释同步新口径（合法值含 dark、无记录跟随系统、与 merge 成对）
acceptance:
  - 系统暗色且无记录时首帧 html data-theme 为 dark，无浅色闪烁（FR-03）
  - 有合法记录（blue/dark）首帧直取记录值；无记录且系统浅色首帧 ai-native（现状不变）
  - 非法或损坏记录与 matchMedia 异常回落 ai-native，与 task-04 merge 兜底逐分支一致
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 脚本保持 ES5 内联字符串写法（var 与 function，禁可选链和箭头函数），不经编译直跑浏览器
  - 首帧不经 useThemeStore，只直读 localStorage sillyhub-theme；不读写其它存储
  - 不做 prefers-color-scheme change 监听（design §3 非目标）；脚本口径单测扩展归 task-10
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
