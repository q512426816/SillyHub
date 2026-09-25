---
id: task-02
title: 'Thin prompt template and dispatch change_key whitelist'
title_zh: '派发 prompt 模板与 change_key 白名单'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-08]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/change/prompts/thin.md
  - backend/app/modules/change/tests/test_thin_stage.py
target_files:
  - backend/app/modules/change/dispatch.py
  - NEW:backend/app/modules/change/prompts/thin.md
  - NEW:backend/app/modules/change/tests/test_thin_stage.py
goal: >
  新增 thin 阶段派发 prompt（2 调用协议含清晰度门过门格式与断点续语义）与派发入口 change_key 白名单（纵深防御拒穿越名），补配置与白名单测试。
implementation:
  - 新建 backend/app/modules/change/prompts/thin.md（骨架对齐 prompts/quick.md 的 Context/Task/Steps/Key Rules 结构）：步骤 1 `sillyspec flow start --change {{change_key}}{{platform_args}} --input "<多行：动机一行 + 独立节头行『成功标准：』+ 每行一条 - <标准>>"`（明示单行内联会被清晰度门 exit 2 拒）；步骤 2 干活：改代码写测试 + 填 design.md 四节 AGENT 槽与 requirements 测试绑定槽（每处至少一行，「不适用：<理由>」也算答）；步骤 3 `sillyspec flow done --change {{change_key}}{{platform_args}}`（中间态 exit 1 属正常，修复后重跑同命令断点续；实测失败=整单失败 fail-closed；归档后自动转归档区）；文案用「轻量变更」（D-002@v1）
  - backend/app/modules/change/dispatch.py 派发入口加 _validate_thin_change_key（仅对 current_stage=="thin" 变更调用）：正则 ^[A-Za-z0-9_.\-]+$ 且拒 "default"、^quick-[0-9a-f]{8}$、含 ".." 段——非法 raise AgentRunError 拒绝派发
  - 新建 backend/app/modules/change/tests/test_thin_stage.py：thin 配置断言（对齐 task-01 落的条目）+ 白名单四态用例（合法 <日期>-<slug>-<hex6> 过 / ".." 拒 / "default" 拒 / "quick-a4939946" 拒 / 含路径分隔拒）
acceptance:
  - thin.md 含 {{change_key}}/{{platform_args}} 变量与过门格式样例（独立节头行 + 列表行，非单行内联）
  - 白名单四态行为符合预期（合法过、非法三态拒并报错）
  - prompt 模板可被 load_prompt_template 渲染（变量替换无残留 {{）
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_thin_stage.py app/modules/change/tests/test_dispatch.py -q --no-cov
constraints:
  - platform_args 沿用现有形态不改（sillyspec 3.30.0 flow 已消费 --spec-root）
  - 不动 STAGE_AGENT_CONFIG 条目（task-01 已落）；守卫逻辑归 task-05
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
