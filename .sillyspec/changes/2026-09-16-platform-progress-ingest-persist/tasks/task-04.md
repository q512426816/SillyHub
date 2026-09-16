---
id: task-04
title: 'P2a parser._extract_title adopts normalize_display_title (reparse keeps normalized title) [target:backend/app/modules/change/parser.py]'
title_zh: 'P2a parser._extract_title 接 normalize_display_title（reparse 不回翻） [target:backend/app/modules/change/parser.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
expects_from:
  - 'task-01 title_norm 的 normalize_display_title(h1, change_key)（reparse 与 documents 推送两写路径同源，防回翻模板 H1）'
allowed_paths:
  - backend/app/modules/change/parser.py
target_files: [backend/app/modules/change/parser.py]
goal: >
  parser._extract_title 读 proposal.md 首 H1 后接 title_norm 归一化（parsed.title =
  normalize_display_title(h1, change_key)），使 reparse 与 documents 推送（task-03）两写路径
  同源，防止 reparse 把已归一化的 changes.title 回翻成模板 H1（FR-04 / D-003@v1）。
implementation:
  - '_extract_title（parser.py:231-244）增 change_key 入参：调用点 :613（parsed.title = self._extract_title(change_dir) or change_key）处 change_key 已在作用域（:591 change_dir.name）'
  - '读到 proposal.md 首 H1 后过归一化再返回：normalize_display_title(h1, change_key)——模板 H1（含「— <key>」后缀变体）→ change_key 去日期前缀；自定义 H1 → 原样'
  - 'proposal.md 缺席 / 无首 H1 → 维持既有回退（返回 None，调用点 or change_key 兜底），回退语义不回归'
  - '从 app.modules.change.title_norm import normalize_display_title（parser 与 title_norm 同包内引用，无环依赖）'
acceptance:
  - 'proposal.md H1 为模板文案（如 提案书（Proposal））或其「— <key>」后缀变体 → parsed.title = change_key 去日期前缀（2026-09-15-ehs-reward-punishment → ehs-reward-punishment）'
  - '自定义 H1 → parsed.title 原样采用；proposal.md 缺席或无首 H1 → parsed.title 回退 change_key（既有语义不回归）'
  - 'reparse 不回翻：documents 通道（task-03）已把 changes.title 归一化为 key 派生名后，同 workspace reparse 写回同值（两写路径同源；行为级断言归 task-07）'
  - 'parser 既有测试全绿（英文 H1 fixture 不在模板清单，原样采用不受影响）'
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov
  - cd backend && uv run ruff check app
  - cd backend && uv run mypy app
constraints:
  - '只改 _extract_title 及其调用点（:613），不碰 MASTER 占位行逻辑（task-05 范围）与 title_norm.py 本体（task-01 范围）'
  - '不新增测试、不调整既有断言：归一化与 reparse 不回翻行为测试归 task-07（change/tests/test_title_normalization.py）'
  - '模板清单不得收录裸英文标题（plan 关键技术要点 3）由 task-01 保证，本卡不重复校准'
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
