---
id: task-04
title: '回归与验收——pnpm exec tsc --noEmit（我方 0 新增）、eslint 4 改动文件 0 告警、vitest sessions-portal+portal-file-panels+session-list-panel+explorer 页零回归，外加 SessionListPanel 直接消费方测试（floating-session-host / agent-log-card，plan 审查 gap 补）、浏览器实拍对照 prototype-sessions-file-browser.html 场景①-④（含切回会话预览保留）、frontend.changelog.md 补条目'
title_zh: '回归与验收——pnpm exec tsc --noEmit（我方 0 新增）、eslint 4 改动文件 0 告警、vitest sessions-portal+portal-file-panels+session-list-panel+explorer 页零回归，外加 SessionListPanel 直接消费方测试（floating-session-host / agent-log-card，plan 审查 gap 补）、浏览器实拍对照 prototype-sessions-file-browser.html 场景①-④（含切回会话预览保留）、frontend.changelog.md 补条目'
author: 'qinyi'
created_at: 2026-09-09 00:39:03
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001, D-004, D-005, D-006]
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/portal-file-panels.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
target_files: []
goal: >
  Wave 3 收尾验收——静态检查（tsc 0 新增 / eslint 改动文件 0 告警）+ 相关面
  vitest 零回归（含 SessionListPanel 直接消费方测试 gap 补）+ 浏览器实拍对照
  prototype-sessions-file-browser.html 场景①-④（含切回会话预览保留）+
  frontend.changelog.md 补条目，确认 design §10 五条验收全部达成（FR-01~05）。
implementation:
  - '静态检查——pnpm -C frontend exec tsc --noEmit 对照改动前基线确认 0 新增错误（若 node_modules 半坏出现假 CSSProperties/Cannot find module 类报错，按 CLAUDE.md 规则 21 先 pnpm install --force 修环境再判定）；pnpm -C frontend exec eslint 四个改动文件——portal-file-panels.tsx、sessions-portal.tsx、session-list-panel.tsx、sessions-portal.test.tsx（portal-file-panels.test.tsx 已由 task-01 verify 覆盖，一并复跑无妨）——0 error 0 warning'
  - 'vitest 相关面零回归——pnpm -C frontend exec vitest run 六个测试文件：sessions-portal（既有 39 + task-03 新增 describe）、portal-file-panels、session-list-panel、explorer 页（"src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx"，实际路径不含 explorer/__tests__ 子目录）、floating-session-host、agent-log-card；后两个为 SessionListPanel 直接消费方测试（floating-session-host.tsx 挂载列表；agent-log-card.test.tsx §8 直接渲染 SessionListPanel 集成徽标）——plan 审查 gap 补，防 headerExtra 插槽改动引发隐性回归'
  - '浏览器实拍（dev server localhost:3001）——对照变更目录 prototype-sessions-file-browser.html 逐场景实拍——①工作区入口全链路（左栏「📁」→本工作区文件树→点文件右侧开预览列→「✕」收起）②全局 /sessions 置灰与跟随（未选中置灰+title 提示；选中带工作区的会话与群聊后可切）③深链翻转（带 ?session= 进入，验证请求完成后按钮由置灰翻转可点，含群深链）④拖宽/双击复位/刷新宽度记忆（左右两把把手 + localStorage）；外加「切回会话预览保留」（开列后「← 返回会话」预览列仍在、重进文件模式树按新工作区且旧预览仍可读）；截图留档到变更目录（平台路径）'
  - 'frontend.changelog.md 补本变更 change 级条目——平台 spec 路径 C:\Users\qinyi\.sillyhub\daemon\specs\b97f8231-9404-43bd-89de-38c281c4d875\docs\multi-agent-platform\modules\frontend.changelog.md（仓库外，不受本卡 allowed_paths 管），按该文件既有条目格式追加'
  - '汇总核对——design §10 五条 + requirements FR-01~05 + 原型四场景逐项确认；发现偏差回 task-03 修复后复跑（本卡不改源码）'
acceptance:
  - 'design §10-5 静态——tsc --noEmit 0 新增错误、eslint 改动文件 0 error 0 warning'
  - 'design §10-5 测试——vitest 六文件零回归（sessions-portal 既有 39 + 新增 describe、portal-file-panels、session-list-panel、explorer 页、floating-session-host、agent-log-card）'
  - 'design §10-1 / 原型场景①——工作区入口「📁」→文件树→点文件开列→「✕」收起全链路实拍通过'
  - 'design §10-2 / 原型场景②——全局入口未选中置灰+title、选中会话/群可解析可切实拍通过'
  - 'design §10-2 / R-05、原型场景③——?session= 深链验证完成后按钮由置灰翻转实拍通过（含群深链）'
  - 'design §10-3——切回会话列表预览列保留、重进文件模式树按最新工作区实拍通过（原型场景含）'
  - 'design §10-4 / 原型场景④——左右把手拖宽（双击复位）、刷新页面宽度记忆实拍通过'
  - 'frontend.changelog.md 已补本变更条目（平台路径，条目含变更名与功能概要）'
verify:
  - 'pnpm -C frontend exec tsc --noEmit'
  - 'pnpm -C frontend exec eslint src/components/sessions/portal-file-panels.tsx src/components/sessions/sessions-portal.tsx src/components/sessions/session-list-panel.tsx src/components/sessions/__tests__/sessions-portal.test.tsx'
  - 'pnpm -C frontend exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx src/components/sessions/__tests__/portal-file-panels.test.tsx src/components/sessions/__tests__/session-list-panel.test.tsx "src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx" src/components/floating/floating-session-host.test.tsx src/components/daemon/__tests__/agent-log-card.test.tsx'
  - '浏览器 http://localhost:3001/workspaces/<id>/sessions 与 http://localhost:3001/sessions 实拍原型场景①-④ + 切回会话预览保留（截图留档变更目录，平台路径）'
constraints:
  - '本卡只读验收不改仓库源码——发现缺陷回 task-03 卡修复后复跑，不在本卡顺手改；frontend.changelog.md 与实拍截图均为平台/变更目录路径，不进仓库 allowed_paths'
  - '禁止跑全量测试（CLAUDE.md 规则 0）——只跑本变更相关六个测试文件，全量留 CI'
  - 'Windows 环境路径含括号/方括号（(dashboard)/[id]），vitest 文件参数须加引号；命令统一 pnpm -C frontend 形式保证跨平台（CLAUDE.md 规则 13）'
  - '实拍对照以变更目录 prototype-sessions-file-browser.html 为准，偏差按 design §10 逐条判定，不凭主观观感放行'
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
