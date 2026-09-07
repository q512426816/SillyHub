---
id: task-01
title: 'wave1-daemon-export-surface-and-reference-baseline'
title_zh: 'Wave1 前置对账——session-manager/task-runner 全量导出面与引用方符号清单（facade 保底基线）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
low_risk: true
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-07-arch-large-file-split/daemon-export-baseline.md
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/task-runner.ts
goal: >
  拆分前固化 session-manager.ts 与 task-runner.ts 的全量导出符号与全部引用方清单，产出 facade 保底基线文档 daemon-export-baseline.md，作为 task-02 与 task-03 拆包后导出面零丢失的对账依据（FR-02、D-004@v1）。
implementation:
  - 用 grep -n "^export" 列出两个源文件的全部导出符号（类、函数、类型、常量），记录符号名与行号
  - 用 grep -rn "session-manager" src tests --include=*.ts 与 grep -rn "task-runner" src tests --include=*.ts 生成全部引用方清单，区分 src 引用方（cli.ts 与 daemon.ts）与测试引用方，并记录每个引用方实际使用的符号
  - 将两类清单写入 changeDir 下 daemon-export-baseline.md，标注 facade 必须保留的 re-export 面与拆前行号基线
acceptance:
  - daemon-export-baseline.md 覆盖两文件全部 export 符号，数量与 grep 实测一致
  - 引用方清单覆盖 src 与 tests 下全部引用（src 侧含 cli.ts 与 daemon.ts）
  - task-02 与 task-03 执行者可仅凭该文档核对 facade 导出面无遗漏
verify:
  - test -s .sillyspec/changes/2026-09-07-arch-large-file-split/daemon-export-baseline.md
  - cd sillyhub-daemon && grep -n "^export" src/interactive/session-manager.ts | wc -l
  - cd sillyhub-daemon && grep -n "^export" src/task-runner.ts | wc -l
constraints:
  - 纯只读对账，两个源文件零修改（仅 grep 阅读，不产出代码、不建包目录、不跑测试）
  - 符号与行号以当日源码实测为准，与 design.md §5 簇区间不一致时以实测为准
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
