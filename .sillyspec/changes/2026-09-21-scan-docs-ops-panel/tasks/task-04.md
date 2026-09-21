---
id: task-04
title: 'CLI docs-inject telemetry hook (sillyspec repo)'
title_zh: 'CLI docs-inject 注入埋点（sillyspec 仓）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-21 09:58:52
priority: P0
depends_on: []
blocks: []
repo: sillyspec
base_commit: 0124b560d761b28a62bbc902e14009d7f112700c
head_commit: 0124b560d761b28a62bbc902e14009d7f112700c
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - src/run/prompt.js
  - src/stages/execute.js
  - NEW:test/docs-inject-telemetry.test.mjs
target_files:
  - src/run/prompt.js
  - src/stages/execute.js
  - NEW:test/docs-inject-telemetry.test.mjs
provides:
  - docs-inject 遥测行（.runtime/knowledge-hits.jsonl 追加 {type:'docs-inject', change, query, matchedFiles:[docs 相对路径], at}，供平台 stats 聚合消费）
goal: >
  在 sillyspec CLI 的模块上下文注入点埋 docs-inject 遥测行，复用既有
  knowledge-hits.jsonl 通道（appendKnowledgeHit），使扫描文档的注入频次可统计。
implementation:
  - 在 sillyspec 仓（仓根 C:/Users/qinyi/IdeaProjects/sillyspec）grep 实定位模块上下文注入实现：src/run/prompt.js 的 buildModuleContextInjection（约 :168 一族）与 src/stages/execute.js 的注入孪生处（现为 knowledge-inject 型 :23/:35/:85；若模块上下文另有本地孪生实现则同步埋）
  - 注入命中处（渲染出模块上下文段且至少命中一个模块）追加遥测：import { appendKnowledgeHit } from '../knowledge-hits.js'（按相对路径实调），行体字段为 type 固定 'docs-inject'、change 取 changeName 或 quick sessionId、query 取匹配查询串（若有）、matchedFiles 取注入的模块文档 doc 路径数组（modules/<x>.md 形态，docs 树相对）、at 缺省自动补 ISO
  - fail-soft：遥测 append 包 try/catch，写失败仅静默降级，不影响注入正文（对齐 buildKnowledgeInjection 的遥测分离先例）
  - 未命中（零模块命中，section 为空）不落行
  - NEW:test/docs-inject-telemetry.test.mjs：临时 spec 目录跑注入——命中落行（断言行体四字段）/未命不落/append 失败（chmod 或 mock 抛错）注入正文不受影响
acceptance:
  - 模块上下文注入命中后 .runtime/knowledge-hits.jsonl 末尾出现一行 type=docs-inject，matchedFiles 为注入的模块文档路径
  - 未命中/开关关闭时不产生行
  - 遥测写失败时注入段照常返回（fail-soft 实证）
  - 既有 knowledge inject/classify 行为与格式零变化
verify:
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && node test/run-tests.mjs test/docs-inject-telemetry.test.mjs
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && npm run lint
constraints:
  - 只 append 行，不改既有行型与 knowledge-hits.js 底座
  - daemon 与平台侧零改动（整 jsonl 上行 + 宽容落库是既有行为）
  - 行体字段名固定（type/change/query/matchedFiles/at），与知识 inject 行同构
  - 不引入新依赖；Windows/Linux/macOS 兼容（appendFileSync 已 LF 归一）
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
