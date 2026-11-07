---
id: task-07
title: 'guard unit tests (compound bypass / multi -m / pathspec / -a / -C / sillyspec push matrix / --undo passthrough)'
title_zh: 'guard 单测（复合命令绕过/msg 多段/pathspec/-a/-C/sillyspec push 参数形态/--undo 不拦）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003, D-012, D-013]
expects_from:
  - task-01 的 detectGitWriteIntent 与 resolveDefaultSelection（被测对象）
allowed_paths:
  - sillyhub-daemon/tests/interactive/git-command-guard.test.ts
target_files:
  - NEW:sillyhub-daemon/tests/interactive/git-command-guard.test.ts
goal: >
  新建 NEW:sillyhub-daemon/tests/interactive/git-command-guard.test.ts（vitest）为 task-01 识别内核建回归安全网：用例矩阵覆盖复合命令拆段与绕过形态（R-01）、-m 多段拼接、pathspec、-a、-C、sillyspec push 参数矩阵（含 --dry-run/--no-push/--undo 三不拦，D-013）、不拦清单（D-003）与预填规则四分支（D-012）——纯字符串输入，不依赖真实 git 仓。
implementation:
  - 新建测试文件（design 文件变更清单指定的 guard 单测），用例按 detectGitWriteIntent / resolveDefaultSelection 两 describe 组织；断言风格对齐 tests/interactive 现有 vitest 用例（intent 各字段精确断言 + null 未命中显式断言）
  - 识别矩阵：裸 git commit / git push 命中；复合命令 git add . && git commit -m x（前缀段不漏判，R-01 回归锚）与 ; / || / | 分隔各形态；多段 git 写操作命中段策略断言；git -C <path> commit 的 workDir
  - 解析矩阵：-m 单段/多段拼接、-F 扩展字段 messageFile、位置参数 pathspec、-a、pathspec 与 -a 并存、push remote/ref 位置参数与缺省 null
  - sillyspec push 参数矩阵（R-09/D-013）：默认形态拦（runner='sillyspec'、command 为命中段原文）、--mode one / --remote origin / --branch main 拦、--dry-run / --no-push / --undo 返回 null
  - 不拦清单（D-003）：git add / git status / git log / git diff / git merge / git rebase / git reset / git checkout -- 与非 git 命令、空串均返回 null
  - 预填规则四分支（D-012）：pathspec 勾 pathspec / -a 勾全部 tracked / 无标记勾暂存区 / 暂存区空勾全部改动
acceptance:
  - 复合命令绕过形态 ≥3 例（&& / ; / || / | 至少各一例）且 git add ... && git commit 断言命中 commit 段（R-01 回归锚）
  - sillyspec push 参数矩阵 ≥4 拦截例 + 三不拦例（--dry-run / --no-push / --undo 均返回 null，D-013）
  - 不拦清单 ≥6 例断言返回 null（D-003）
  - -m 多段拼接 / pathspec / -a / -C / push 缺省与显式 remote-ref 解析断言齐全
  - resolveDefaultSelection 四分支断言齐全（D-012）
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/git-command-guard.test.ts 全绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/git-command-guard.test.ts
constraints:
  - 只测 task-01 纯函数：不测挂载（task-03/04）、采集（task-02）、代执行（W2）；断言暴露实现缺陷时回改 task-01 实现，禁止改测试迁就（规则：非测试逻辑有误禁改测试通过）
  - 纯字符串用例：不 spawn 子进程、不建真实 git 仓、不依赖平台路径形态
  - 规则 0 禁全量测试，仅跑本测试文件；vitest 风格与 tests/interactive 现有用例一致
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
