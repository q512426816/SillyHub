---
id: task-07
title: '前端 CtxUsageBar caps 门控 + 两调用点传 provider + vitest'
title_zh: 'CtxUsageBar caps 门控 + 调用点传 provider'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 01:12:24
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
expects_from:
  - 'task-06：frontend/src/lib/provider-caps.ts @generated 产物含第 11 键 ctx_usage（四引擎 true / 未知引擎回退 false），getProviderCaps().ctx_usage 可消费'
allowed_paths:
  - frontend/src/components/sessions/ctx-usage-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  前端消费 ctx_usage 能力键（FR-06）：CtxUsageBar 按 getProviderCaps(provider).ctx_usage
  门控环渲染——false 只渲染 QuotaPill（防未来不支持引擎永远「—」误导），全仓仅有的
  两个调用点传引擎名；当前四引擎全 true 用户界面零变化，provider null/未传旁路
  渲染保本机默认供应商等场景不回归。
implementation:
  - 'ctx-usage-bar.tsx：CtxUsageBarProps 追加 provider?: string | null（docblock 注明「会话引擎名（INTERACTIVE_PROVIDERS 键）；caps.ctx_usage=false 不渲染环。null/未传照常渲染」，与既有 providerId prop 并列）；从 @/lib/provider-caps 引入 getProviderCaps'
  - 'CtxUsageBar 组件体（:423-433）：const ctxSupported = provider == null || getProviderCaps(provider).ctx_usage; —— ctxSupported 为 false 时只渲染 QuotaPill（CtxUsageRing 不渲染），true 时环+胶囊组装不变（providerId 语义不动）'
  - 'session-panel-page.tsx 两调用点传 provider（全仓仅此两处，Grill X-c 核实）：:2709 预会话 trailing 加 provider={preEngine}（与同处 :2700 engine prop 同源作用域变量，string | null）；:3501 真会话 trailing 加 provider={session.provider ?? null}（与 :3487 engine prop 同式）'
  - 'ctx-usage-bar.test.tsx 新增门控 describe 三分支（provider-caps.ts 为纯 @generated 常量表，直接用真实模块即可，无需 mock）：①caps false——传虚构 provider 名（getProviderCaps 未知引擎回退 ctx_usage=false 恰好命中门控）断言 queryByTestId("ctx-ring") 不存在、QuotaPill 挂载；②现有四引擎名（如 claude，ctx_usage=true）照常渲染环显示百分比；③不传 provider（undefined）照常渲染环（既有 :144 用例即此形态，补显式断言锚定旁路语义）'
acceptance:
  - 'vitest 门控三分支绿：caps false（虚构 provider 名）不渲染环只渲染 QuotaPill / 四引擎名（ctx_usage=true）照常渲染环 / 不传 provider 照常渲染环'
  - 'session-panel-page.tsx 两调用点均传 provider（:2709 preEngine / :3501 session.provider ?? null），无遗漏调用点（sessions-portal / floating-session-host 仅注释提及不渲染该组件）'
  - '既有用例零回归——四引擎 caps 全 true 门控不改变现有渲染（含 :144 不传 provider 形态与 QuotaPill 全部既有断言）'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm test ctx-usage-bar'
  - 'cd frontend && pnpm lint'
constraints:
  - '不改 CtxUsageRing 视觉 / 阈值变色 / 详情浮层交互与分母四级解析链（NG-05）——门控只决定环渲染与否'
  - 'provider=null/undefined 旁路渲染（本机默认供应商等场景不回归，不因门控丢现有功能；环仍有未知态「—」兜底）'
  - '不改 providerId prop 语义与 QuotaPill 行为（额度查询照旧）；不动 provider-caps.ts（@generated 产物，属 task-06 域）'
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
