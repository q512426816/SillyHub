---
id: task-16
title: 'final-self-test-matrix-and-doc-audit'
title_zh: '全量自测清单（双主题切换/键盘避让/深链矩阵/桌面既有测试全绿）+ 文档核对（X-03 组件复用落位清单、X-04 key 锁形态用例）'
author: 'qinyi'
created_at: 2026-08-27 00:35:07
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10', 'task-11', 'task-12', 'task-13', 'task-14', 'task-15']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11]
decision_ids: [D-001@V1]
allowed_paths:
  - .sillyspec/changes/2026-08-26-mobile-workspace-page/
  - frontend/src/app/m/
  - frontend/src/components/mobile/
  - frontend/src/components/daemon/
  - frontend/src/components/sessions/
goal: >
  task-01~15 全部完成后的收尾自测与文档对账（design §12/§14 手测清单）：桌面既有测试全绿、
  深链矩阵/双主题/键盘避让/SSE 重连逐项核验，X-03 落位清单与 X-04 key 锁用例落盘供 verify/archive 对账。
implementation:
  - 桌面既有测试回归（仅相关文件，禁全量）：src/components/daemon/__tests__/session-panel-*、src/components/sessions/__tests__/pre-session-picker.test.tsx、src/app/m/layout.test.tsx、src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx 全绿
  - 深链矩阵手测 7 条（手机视口/真机）：/workspaces/:id（主页 redirect 落变更列表）、/changes 列表直出、/changes/[cid] 详情直出、/sessions 会话列表、/sessions/[sid] 对话页，加 /changes/[cid]/sessions 与 /quicklog/[qlId]/sessions 两条兜底 redirect 到 /m/workspaces/:id/sessions
  - 双主题（blue/ai-native）切换抽检：grep 移动新文件无写死色值（hex/rgb 字面量），取色全走 brand-*/语义 token；触摸热区 ≥44px、正文 ≥14px 抽检
  - 真机或浏览器移动视口核验 R-06 键盘避让（输入条可见不被遮）与 R-02 SSE 锁屏断线重连（design §10），记录环境与结论
  - X-03：components/changes/detail/* 逐组件（复用/重绘）落位决定清单落盘变更目录；X-04：会话列表 query key ["agentSessions","sessionsPortal",scope,{…}] 锁形态用例确认存在并落盘
  - 集成冒烟（plan 全局验收2）：选择器→主页→变更列表→详情→审批（可 mock）→文档预览→返回；会话列表→对话页 SessionPanel 渲染→输入条可见
acceptance:
  - 桌面既有相关测试全绿（session-panel-* / pre-session-picker / page.m-workspaces / m-layout 相关测试文件）
  - 深链矩阵 7 条全通过（五条直出 + 两条兜底 redirect 到会话列表，不落 404）
  - 双主题抽检无写死色值；键盘避让与 SSE 重连结论已记录（注明真机/移动视口环境）
  - X-03 组件复用落位清单 + X-04 key 锁形态用例文档已落盘到变更目录
verify:
  - cd frontend && pnpm test -- src/app/m src/components/mobile
  - cd frontend && pnpm test -- src/components/daemon/__tests__/session-panel src/components/sessions/__tests__/pre-session-picker src/app/m/layout.test.tsx src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 本任务不新增功能代码；发现缺陷记录到变更目录并回指对应 task 修复，不自行大改
  - 禁全量测试（CLAUDE.md 规则 0）：仅按目录/文件模式跑相关测试，全量留给 CI
  - X-03/X-04 文档与手测记录统一落盘到变更目录，注明环境与结论
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
