---
id: task-13
title: 'wave3-preflight-session-panel-and-lib-daemon-export-baseline'
title_zh: 'Wave3 前置对账——session-panel 7 符号 + lib/daemon 全量导出面清单'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-12']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-07-arch-large-file-split/frontend-export-baseline.md
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/lib/daemon.ts
goal: >
  产出 Wave3 拆分保底基线——session-panel 7 符号与 lib/daemon 全量导出面及 mock 形状清单，供 task-14/15 的 index 再导出逐项对账，防 BashProgressState 之类的漏导破坏 D-006。
implementation:
  - grep -n "^export" session-panel.tsx 生成 7 符号全清单（SessionPanel、SessionPanelProps、SessionPreContext、BashProgressState、applyBashStatusEvent、appendBashChunk、applyAgentTaskStatusEvent，末项为自 agent-task-store 的再导出）
  - grep -n "^export" lib/daemon.ts 生成全量导出面清单（2026-09-07 实测 187 条），逐条记录符号名/类别/行号
  - grep -rn vi.mock 统计 @/lib/daemon mock 计数并记录 importOriginal 展开覆写的形状要点
  - 汇总写入 changeDir 下 frontend-export-baseline.md，附 grep 原始输出与消费约束
acceptance:
  - frontend-export-baseline.md 存在且含 session-panel 7 符号逐条清单（BashProgressState 不得漏记）
  - 含 lib/daemon 全量导出清单（逐条不抽样）与 vi.mock 计数及形状说明
  - 两个被读源文件零改动，纯只读对账
verify:
  - cd frontend && grep -n "^export" src/components/daemon/session-panel.tsx
  - cd frontend && grep -c "^export" src/lib/daemon.ts
  - cd frontend && grep -rn "vi.mock(\"@/lib/daemon" src | wc -l
constraints:
  - 只读源文件，对账产物仅写入 changeDir 内基线文档
  - 清单必须全量逐条，禁止抽样或只记数量
  - 不改任何 frontend 代码与测试
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
