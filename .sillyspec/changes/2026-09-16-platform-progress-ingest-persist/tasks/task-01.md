---
id: task-01
title: 'Add shared title normalization helper module'
title_zh: '新建 title_norm.py 共享归一化 helper（模板 H1 归一化回退 change_key 派生名）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: []
blocks: [task-03, task-04]
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/change/title_norm.py
provides:
  fields:
    - normalize_display_title
    - extract_h1
    - TEMPLATE_H1_RE
target_files:
  - NEW:backend/app/modules/change/title_norm.py
goal: >
  新建 change/title_norm.py 共享归一化 helper，把「模板 H1 → 展示 title」的规则
  收敛一处，供 task-03（upsert_documents 重派生）与 task-04（parser
  _extract_title 接归一化）两条写路径同源消费，防 reparse 与文档推送互相回翻。
implementation:
  - 新建纯函数小模块（无 DB/session 依赖，platform_sync 与 parser 双向引用无环）
  - 实现 extract_h1(text)——取 markdown 全文首个一级标题文本（strip 后），无则 None，语义与 parser _extract_title 逐行扫描一致，供 documents 推送路径复用（文档全文在内存，无需落盘）
  - 实现 normalize_display_title(h1, change_key)——H1 命中模板（等于模板串，或模板串加 em dash 后缀变体）或 H1 缺失/空串 → 返回 change_key 去日期前缀（_DISPLAY_KEY_RE 同款正则口径 ^\d{4}-\d{2}-\d{2}-；key 无日期前缀或去后为空则原样用 key）；自定义 H1（含 提案：xxx 冒号形式）→ strip 后原样返回
  - 定义 TEMPLATE_H1_RE 模板标题集，以本仓 .sillyspec/changes/** 各标准文档实测 H1 家族校准——提案书（Proposal）/需求规格（Requirements）/需求文档（Requirements）/设计文档（Design）/实现计划（Plan）/任务清单（Tasks）/验证报告（Verify Result）/模块影响分析（Module Impact），并覆盖无括号与后缀变体
  - 模块 docstring 写明校准口径与「禁收裸英文标题」的原因（parser 既有 fixture 用英文 H1 表达自定义标题）
acceptance:
  - 模板 H1（提案书（Proposal）及其 — change_key 后缀变体）归一化为 key 去日期前缀短名（2026-09-15-ehs-reward-punishment → ehs-reward-punishment）
  - 自定义 H1 原样返回；H1 缺失回退 key 派生名；key 无日期前缀或去后为空时原样用 key
  - 裸英文 Proposal/Requirements/Design/Plan/Tasks 不在模板集内、原样返回（backend/app/modules/change/tests/test_parser.py:55 的 title == Proposal 断言不受影响）
  - 模块为纯函数无副作用，ruff check 与 mypy 通过
verify:
  - cd backend && uv run ruff check app
  - cd backend && uv run mypy app
constraints:
  - 禁收裸英文标题（Proposal 等）入模板集——parser 既有测试 fixture（backend/app/modules/change/tests/test_parser.py:55）用英文 H1 表达自定义标题，收录会连坐既有断言（plan 审查备忘）
  - 本 task 只建 helper 模块不改消费方——parser 接线是 task-04、upsert_documents 重派生是 task-03；新测试由 task-07 统一负责，本 task 不新增测试文件
  - 归一化必须是纯函数单一实现，不允许两侧消费方各自内联复制（防两写路径规则漂移互相回翻）
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
