---
id: task-01
title: 'themes.ts semantic soft 浅底阶扩展（三主题各配，旧单值字段保留）'
title_zh: 'themes.ts semantic soft 浅底阶扩展（三主题各配，旧单值字段保留）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/styles/themes.ts
  - frontend/src/styles/themes.test.ts
  - frontend/src/app/globals.css
target_files:
  - frontend/src/styles/themes.ts
  - frontend/src/styles/themes.test.ts
  - frontend/src/app/globals.css
goal: >
  给 themes.ts semantic 五档（success/warning/error/info/neutral）扩展 soft 浅底阶，
  供 StateLabel 浅底深字胶囊消费（GitHub label 质感），三主题各配且旧单值字段零破坏。
implementation:
  - frontend/src/styles/themes.ts:读现有 semantic 结构（五档单值 string），新增 soft 浅底映射（形态：semantic 同级 soft 键或嵌套对象，以最小侵入为准）；blue/ai-native 配语义色浅底（50/100 档观感），dark 配 rgba(语义色,0.15) 半透明底
  - frontend/src/app/globals.css:html[data-theme] 三主题块注入 --semantic-{success|warning|error|info|neutral}-soft CSS var（对齐既有 var 注入模式）
  - antd ConfigProvider 取值逻辑零改动（soft 阶不进 antd token）
acceptance:
  - 三主题 html[data-theme] 下 5 个 --semantic-*-soft var 均有非空值（getComputedStyle 可取）
  - 既有 semantic 单值字段与全部既有 var 零改动（diff 仅新增行）
  - tsc 0 新增错误
verify:
  - cd frontend && pnpm typecheck
  - grep -c "semantic-.*-soft" frontend/src/app/globals.css（应 ≥15：三主题×五档）
constraints:
  - 不改 ThemeName 类型与主题切换逻辑；不新增主题
  - 不动 brand/slate 阶；soft 值不硬编码进组件（组件只消费 var/语义类）
  - 兼容性：任何现有消费 semantic 单值的代码零改动（FR-02 承接 FR-styles-004/007 零回归）
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
