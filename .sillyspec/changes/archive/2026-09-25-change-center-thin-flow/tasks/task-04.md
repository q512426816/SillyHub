---
id: task-04
title: 'Recognize sillyspec flow commands in spec binding'
title_zh: '会话绑定：识别 flow 命令族'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change/binding.py
  - backend/app/modules/change/tests/test_spec_binding.py
target_files:
  - backend/app/modules/change/binding.py
  - backend/app/modules/change/tests/test_spec_binding.py
goal: >
  extract_spec_bindings 识别 sillyspec flow start|done|amend-draft 命令族的 --change 变更名，使 thin 派发会话经命令解析通道正确绑定变更（stage 派发会话绑定的唯一通道）。
implementation:
  - backend/app/modules/change/binding.py:49-87 循环内增加第二类命中：tokens[i]=="sillyspec" 且 tokens[i+1]=="flow" 且 tokens[i+2]∈{start,done,amend-draft} → _parse_change_key(tokens, start=i+3)（复用既有望名函数：--change <名>/--change=<名>，default 跳过）
  - 既有 sillyspec run 分支与 run quick 跳过规则（:80-82，D-004@v1）原样保留；docstring 补 thin 语义说明
  - backend/app/modules/change/tests/test_spec_binding.py 补三命令用例：flow start --change X / flow done --change=X / flow amend-draft --change X 各产出 SpecCommandBinding(kind="change")；run quick 仍零产出回归
acceptance:
  - flow start/done/amend-draft 三命令各产出 kind=change 绑定（含等号形态与 pnpm 包装剥除形态）
  - sillyspec run quick 仍跳过；--change 缺失或值为 default 无产出；非 sillyspec 命令零产出
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_spec_binding.py -q --no-cov
constraints:
  - 不改 bind_session_to_change 与 quicklog 绑定路径；包装剥除经 iter_command_segments 天然兼容不另写
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
