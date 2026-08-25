---
id: task-07
title: '主题合规与整链路验收（三主题对照 FRONTEND_PAGE_STYLE §12 + ≥8 泳道辨识度证据 + 真机全链路手测记录）'
title_zh: '主题合规与整链路验收（三主题对照 FRONTEND_PAGE_STYLE §12 + ≥8 泳道辨识度证据 + 真机全链路手测记录）'
author: 'qinyi'
created_at: 2026-08-25 21:37:20
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx
  - frontend/src/components/git-log/commit-graph.tsx
  - frontend/src/components/git-log/__tests__/lane-palette.evidence.test.tsx
  - .sillyspec/changes/2026-08-25-workspace-git-log/verify-evidence-theme.md
goal: >
  对 Git 日志页做主题合规与整链路验收——三主题逐项对照 FRONTEND_PAGE_STYLE §12 迁移清单、
  留存 ≥8 泳道辨识度证据、真机手测全链路六场景，全部证据落盘 verify-evidence-theme.md，为整个变更收口。
implementation:
  - 新建 .sillyspec/changes/2026-08-25-workspace-git-log/verify-evidence-theme.md 留证文档，后续所有核验与手测结果全部写入该文件
  - 对照 .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md §12 迁移检查清单，在 blue/ai-native/dark 三主题下逐项核验 Git 日志页（page.tsx 骨架、commit-graph 泳道 SVG、themes.ts token 消费链、tab 内禁用 md 等视口响应式前缀），逐项记录 pass 或 fail
  - 构造或寻找 ≥8 并发分支的仓库数据渲染泳道视图，留存截图或 DOM 证据作辨识度证据（对应 design §12 遗留第 2 条）；同色相邻 lane 不可辨识时如实记录并报告，不顺手扩色板
  - 真机全链路手测六场景（列表加载 / 翻页 lane 连续一致 / 分支与作者过滤 / 提交详情与单文件 diff / 非 git 工作区空态卡 / daemon 停机 502 降级卡），逐步记录到留证文档
  - 在主仓库根目录跑 local.yaml 全量命令（build / test / lint，test_strategy=module 按 git diff 命中模块执行），留存三子项目输出
acceptance:
  - 三主题（blue/ai-native/dark）对照 FRONTEND_PAGE_STYLE §12 清单逐项 pass 的核验记录已写入留证文档
  - ≥8 并发泳道辨识度证据（截图或 DOM 证据）已写入留证文档
  - 真机全链路手测六场景（列表 / 翻页 lane 连续 / 过滤 / 详情与 diff / 空态 / daemon 停机 502）结果已写入留证文档
  - 三子项目（frontend / backend / sillyhub-daemon）lint 与 test 全绿输出已留存
verify:
  - cd frontend && pnpm build && cd ../sillyhub-daemon && pnpm build
constraints:
  - 只验收不改码——发现主题或链路问题时报告回主代理裁定，本 task 不顺手修改任何源码
  - 一切结论必须落盘为留证文档内的文件证据，不留口头结论
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
