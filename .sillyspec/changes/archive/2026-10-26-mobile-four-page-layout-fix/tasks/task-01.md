---
id: task-01
title: 'mobile-app-shell 底部避让 safe-area 精确化 + mobile-tab-bar 不透明底（FR-07）'
title_zh: 'mobile-app-shell 底部避让 safe-area 精确化 + mobile-tab-bar 不透明底（FR-07）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/mobile/mobile-app-shell.tsx
  - frontend/src/components/mobile/mobile-tab-bar.tsx
  - frontend/src/components/mobile/mobile-tab-bar.test.tsx
target_files:
  - frontend/src/components/mobile/mobile-app-shell.tsx
  - frontend/src/components/mobile/mobile-tab-bar.tsx
goal: >
  治 /m/ 全局底部遮挡：外壳 main 的固定 pb-28 改为「TabBar 胶囊 56px + 底距 12px +
  env(safe-area-inset-bottom) + 缓冲」精确计算（桌面模拟 safe-area=0 时退化值仍须足够）；
  TabBar 胶囊加不透明底，滚动内容从下方穿过不再透字。
implementation:
  - mobile-app-shell.tsx：main 的 pb-28 改 arbitrary value calc 组合（含 env(safe-area-inset-bottom, 0px) fallback），注释写清口径（56+12+缓冲 8）
  - mobile-tab-bar.tsx：胶囊容器底色改实底（bg-background 或不透明度 ≥95% + backdrop-blur），确认悬浮形态视觉干净
  - mobile-tab-bar.test.tsx：补渲染快照/结构断言（胶囊根 testid 存在、底色类生效）
acceptance:
  - 桌面模拟（safe-area=0）避让值 ≥76px，列表末项滚动到底完整可见
  - mobile-tab-bar 既有测试全绿 + 新增底色断言通过
  - /m/ 之外零改动（diff 仅限 allowed_paths）
verify:
  - cd frontend && pnpm vitest run src/components/mobile/mobile-tab-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动 MobileTopBar 与 TabBar 交互/高亮逻辑
  - 不改 TabBar 胶囊尺寸（56px 口径被外壳避让引用，改尺寸须两处同步）
  - 不引入全局样式（改动仅限两组件内）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
