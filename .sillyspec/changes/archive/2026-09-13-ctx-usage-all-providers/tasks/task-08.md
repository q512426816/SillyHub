---
id: task-08
title: 'onboarding 文档补派生口径说明 + 真机验证三引擎（含 spike-01 codex last）'
title_zh: 'onboarding 文档补口径 + 三引擎真机验证（含 spike-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 01:12:24
priority: P0
depends_on: ['task-02', 'task-03', 'task-04', 'task-06']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - docs/agent-provider-onboarding.md
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  变更收口验证（FR-07）：spike-01 真机实证 codex tokenUsage.last 字段形态
  （R-01 唯一未实证假设，不通过即走降级）、pi turn_end 单调用语义真机复核
  （R-02）、三引擎真机冒烟环显示真实百分比；onboarding 文档补两种 ctx 派生
  口径与 caps ctx_usage 登记指引。
implementation:
  - '①spike-01（首步，plan 前置验证并入本 task）：真机起 daemon 或直接 codex app-server（本机 codex-cli 0.147.0 在装）跑一轮会话，抓 thread/tokenUsage/updated 原始通知，确认 last 字段存在且 last.inputTokens ≈ 当前上下文大小（单调用毛值口径）；结论记 QUICKLOG（ql 条目由主代理统一登记）。不通过 → R-01 降级：task-04 移除 last 消费与 ctx_tokens 携带 + PROVIDER_CAPS.codex.ctx_usage 翻 false + 重跑 gen 脚本刷新两端产物 + 守护测试同步（代码回退落在 task-04 文件域，如触发由主代理协调执行）'
  - '②pi 真机复核（R-02）：本机 pi 0.81.1 跑含多工具调用的会话轮，核对 turn_end.usage 与末次 message_end.usage 逐字段一致（单调用终值快照语义，非轮累计求和）；若意外为轮累计则 pi 降级为不携带 ctx_tokens 并如实翻 caps（宁可 unknown 不造假）'
  - '③三引擎（pi / codex / cursor）真机冒烟：各跑一轮会话，会话页环显示真实百分比（截图或数值回执记 QUICKLOG）；顺带确认历史 run ctx NULL 环未知态「—」不回归'
  - '④docs/agent-provider-onboarding.md 更新：§5.2 usage 五字段短名契约处（:342-344 附近）补两种派生口径——净值三和（input 不含 cache 的引擎：claude / pi / cursor，ctx_tokens = input + cache_read + cache_creation，缺分量按 0 计全缺不伪造）与毛值直取（input 含 cache 的引擎：codex，ctx_tokens = 单调用 inputTokens）；caps 单源步骤补 ctx_usage 第 11 键登记指引（interactive 引擎必填、按实测如实取值，「8 键」计数同步 11 键）；附 gen-provider-caps.mjs 解析器只认 boolean / 三值字符串的限制注记（R-04：未来数值型能力键会踩坑，既有债务备忘）'
acceptance:
  - 'QUICKLOG 有 spike-01 结论回执：last 字段形态 + last.inputTokens ≈ 当前上下文大小的实测数值；或明确记录不通过与 R-01 降级执行情况'
  - '三引擎真机回执：pi / codex / cursor 会话环均显示真实百分比（截图或数值）；codex 若走 R-01 降级则环如实未知态且 caps=false 的翻改有记录'
  - 'onboarding 文档更新落地：两种派生口径说明 + caps ctx_usage 登记指引（键计数同步）+ 解析器限制注记（R-04）'
verify:
  - 'docs/agent-provider-onboarding.md diff 审阅（口径表述与 design.md Wave A helper 语义、R-04 一致）'
  - 'QUICKLOG 登记（spike-01 结论 + pi 语义复核 + 三引擎真机回执；ql 条目由主代理统一写入）'
  - '若触发 R-01 降级：守护测试重跑绿（provider-registry.test.ts + test_provider_caps_alignment.py，task-04 回退与 caps 翻改后）'
constraints:
  - '真机验证用本机已装 codex-cli 0.147.0 / pi 0.81.1；不伪造数据——last 缺失 / 形态不符走 R-01 降级路径如实翻 caps，宁可 unknown 不造假'
  - 'spike 通过则本 task 零代码改动（纯文档 + 真机验证）；R-01 降级的代码回退属 task-04 文件域，不在本卡 allowed_paths 内，如触发由主代理协调'
  - 'QUICKLOG ql 条目由主代理统一登记，本 task 只产出结论内容；不做历史数据迁移（NG-02）、不动 budget / _liftSessionUsage 口径（NG-04）'
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
