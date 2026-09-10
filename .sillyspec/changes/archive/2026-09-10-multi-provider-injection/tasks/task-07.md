---
id: task-07
title: '真实 CLI 冒烟（mock 三条）+ api-types 零漂移 + 模块文档'
title_zh: '真实 CLI 冒烟（mock 三条）+ api-types 零漂移 + 模块文档'
author: 'qinyi'
created_at: 2026-09-10 23:27:51
priority: P0
depends_on: ['task-03', 'task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-002, D-006]
allowed_paths:
  - sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts
  - .sillyspec/docs/sillyhub-daemon/modules/
target_files:
  - NEW:sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts
provides:
  - 冒烟证据——mock 端点三条端到端（codex /v1/responses 含 Bearer；pi /v1/chat/completions；litellm 通道一条）+ 写盘器模块文档（CLI 版本基线入档）
expects_from:
  task-03:
    - contract: codex_pi_wiring
      needs: [spawn_wiring]
    - contract: applyProviderFileSettings
      needs: [per_session_dir_layout]
  task-04:
    - contract: hot_switch_rewrite
      needs: [rewrite_observable]
  task-05:
    - contract: llm_provider_codex_vocab
      needs: [codex_vocab]
goal: >
  照 spike 手法（本地 mock HTTP 端点记录 path/Authorization/model，不耗真实 key）对真实 codex/pi CLI
  跑三条端到端冒烟（codex Responses 命中 / pi chat 命中 / litellm_proxy 通道一条验 R-02 残差，D-006），
  写盘产物对 spike golden（a2b-config.toml/b1-models.json）逐字段复验（D-002），并补写盘器模块文档
  （CLI 版本基线入档 R-03）收尾整变更。
implementation:
  - 冒烟经真实 spawn 链验证而非直调写盘器；含一条活跃会话热切换重写断言；前置复验双仓 gen:types:check 零漂移
  - NEW provider-injection-smoke.integ.test.ts——测试内起 mock 端点记 path/Authorization 前缀/model（spike mock_server 手法）；codex/pi CLI 缺席动态 return 跳过（照 agent-detector.system-claude.integ.test.ts:71 惯例，不用 it.skip）
  - 三条用例——codex 经 spawn 接线链打 mock /v1/responses 断言 Bearer+model；pi 自定义端点打 /v1/chat/completions；openai_chat 形态经 litellm_proxy 通道一条（验 Responses 兼容残差 R-02）
  - 热切换一条——活跃会话 PROVIDER_CONFIG_CHANGED 后目录文件重写断言（消费 task-04 可观测动作）
  - golden 对照——写盘产物与 spike 证据 a2b-config.toml/b1-models.json 逐字段断言（plan AC-5）
  - 模块文档——NEW codex-settings.md / pi-settings.md（照 claude-settings.md 卡式；记 CLI 版本基线 codex 0.147.0 / pi 0.81.1 与 wire_api 仅 responses 事实源注释，R-03）+ _module-map.yaml 登记两模块
acceptance:
  - 本机有 CLI 环境下三条冒烟全绿；无 CLI 环境动态跳过不红（CI 不因缺席挂）
  - 写盘产物与 spike golden 逐字段一致；litellm 通道残差如有——文档如实标注降级路径不隐瞒
  - 模块文档两卡落盘且 module-map 登记；双仓 gen:types:check 零漂移
# 模块文档三件（codex-settings.md/pi-settings.md/_module-map.yaml）按「spec 产物写主仓」规则落主仓（execute review changedFiles 已列），不属 worktree 交付物故不入 target_files；随归档提交。
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/provider-injection-smoke.integ.test.ts && pnpm gen:types:check
  - cd frontend && pnpm gen:types:check
constraints:
  - 不消耗真实 key——mock 端点全链（spike 判据=mock 日志命中）
  - 不为冒烟改产品代码——只加测试与文档；发现缺陷回报开新卡不顺手扩 scope
  - 模块文档中文撰写循 claude-settings.md 既有卡结构（CLAUDE.md 12）
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
