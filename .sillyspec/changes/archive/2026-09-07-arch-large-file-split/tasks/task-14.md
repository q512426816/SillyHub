---
id: task-14
title: 'Wave3 拆分 session-panel.tsx → session-panel/ 11 文件目录（index 7 符号再导出；page ≤3000 / dialog ≤2000 豁免）'
title_zh: 'Wave3 拆分 session-panel.tsx → session-panel/ 11 文件目录（index 7 符号再导出；page ≤3000 / dialog ≤2000 豁免）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-13']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/session-panel/index.tsx
  - frontend/src/components/daemon/session-panel/team-trigger-row.tsx
  - frontend/src/components/daemon/session-panel/worker-session-overlay.tsx
  - frontend/src/components/daemon/session-panel/use-stream-connection-guard.ts
  - frontend/src/components/daemon/session-panel/connection-banners.tsx
  - frontend/src/components/daemon/session-panel/use-session-team-missions.ts
  - frontend/src/components/daemon/session-panel/turn-state.ts
  - frontend/src/components/daemon/session-panel/search.ts
  - frontend/src/components/daemon/session-panel/dialog-helpers.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
goal: >
  按 design §5 Wave 3 表把 6620 行 session-panel.tsx 拆为 session-panel/ 目录 11 文件，index.tsx 再导出 7 符号保持导出面不变，24 个引用文件与既有测试零改动。
implementation:
  - 先搬纯函数与低耦合部分（search、turn-state、dialog-helpers、两个 hook、team-trigger-row、worker-session-overlay、connection-banners）
  - session-panel-page.tsx 承接 SessionPanelPage（仅再提取纯逻辑，handler 保持组件内，R-03）；session-panel-dialog.tsx 承接 SessionPanelDialog 与 establishStream 簇（闭包状态原样保留）
  - index.tsx 做 SessionPanel 分发器并再导出 7 符号（SessionPanel、SessionPanelProps、SessionPreContext、BashProgressState、applyBashStatusEvent、appendBashChunk、applyAgentTaskStatusEvent），对照 task-13 基线逐项核对后删除原 session-panel.tsx，每搬一批跑定向测试全绿再搬下一批
acceptance:
  - index.tsx 再导出面与拆前 7 符号完全一致，BashProgressState 等被测试导入符号无遗漏
  - src/components/daemon/__tests__ 下 58 个测试文件零修改全绿
  - session-panel-page.tsx ≤3000 行、session-panel-dialog.tsx ≤2000 行（D-005@v3 显式豁免），其余新文件 ≤800 行
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__ --silent
constraints:
  - 不合并 page 与 dialog 两模式重复 handler 为共享 hook（Non-Goals，闭包回归风险）
  - 只搬移不改逻辑，不改文案与样式，零行为变化；不改既有测试与引用文件的 import 路径
  - 不触碰 lib/daemon.ts 与 D-001 排除的在途文件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
