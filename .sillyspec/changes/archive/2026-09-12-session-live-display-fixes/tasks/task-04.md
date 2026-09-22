---
id: task-04
title: 'extractCode 原因短语锚定 + 静默断流专属文案（FR-2.1/2.2/2.3）'
title_zh: 'extractCode 原因短语锚定 + 静默断流专属文案（FR-2.1/2.2/2.3）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-2.1, FR-2.2, FR-2.3]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/model-error/classifier.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
target_files:
  - sillyhub-daemon/src/model-error/classifier.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
goal: >
  修复失败卡误显伪 code:116（extractCode 裸三位数字兜底误抓 api_calls=116）并为静默断流签名提供准确中文归因文案；零测试破坏（401/502 既有断言经原因短语锚定分支继续命中）。
implementation:
  - classifier.ts extractCode（约 L129-137）第 3 兜底：裸三位数字分支替换为 HTTP 原因短语锚定分支（3 位数字 + 空白 + 大写开头词，即 reason phrase 形态，正则见 design R2）；其余四分支（括号码/HTTP 前缀/status:/http=）不动；注意整条正则 i flag 对大写锚定的放宽影响（验收断言按宽口径写）。
  - classifyModelError：blob 含 [silent stream truncation] 签名时，message 覆写「上游输出流中断，本轮未产生收尾回复」、hint 覆写「上游输出流中断，已支持自动续跑；若未自动续跑可重试或切换供应商」；type 维持关键词分类结果（零分类学变更）。
  - 测试：新增 api_calls=116, final_text=y 出码 null 回归用例（本 bug）；'401 Unauthorized: invalid api key' 出码 401、'502 Bad Gateway' 出码 502 既有断言不变；(429)/HTTP 429/status: 502/http=503 出码不变；truncation 签名 message/hint 覆写 + type 仍 provider_error + code null。
acceptance:
  - api_calls=116 不再出码；401/502/429 系列断言全绿（零破坏）。
  - truncation 签名文案覆写正确且 type 不变。
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/model-error/classifier.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不改 TYPE_DISPLAY 表与 type 判定序（auto-recovery TRANSIENT_ERROR_TYPES 依赖）。
  - 不动 extractCode 前两分支（方括号业务码/EN 网络码）。
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
