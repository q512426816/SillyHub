---
id: task-08
title: '前端表单引擎多选（Checkbox.Group + openai 禁 pi 前置 + 收缩引擎默认空缺 toast 提示）+ 列表多徽标'
title_zh: '前端表单引擎多选（Checkbox.Group + openai 禁 pi 前置 + 收缩引擎默认空缺 toast 提示）+ 列表多徽标'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/llm-providers/
target_files:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
  - frontend/src/components/llm-providers/llm-provider-list.tsx
goal: >
  供应商表单引擎区从单选 Select 改为 Checkbox.Group 形态多选（design 总体方案
  Wave2 第 5 条，D-001/D-004 一条凭证服务多引擎），并落地 pi×openai_chat 组合
  禁用前置、收缩引擎默认空缺 toast（R-05）与列表多引擎徽标（Wave2 第 6 条）。
implementation:
  - frontend/src/components/llm-providers/llm-provider-form.tsx:228-232 单值 state agentKind 改为集合 state（agentKinds，LlmProviderAgentKind[] 数组形态），编辑态初值取 initial.agent_kinds，新建缺省 ["claude"]，未知值过滤归一
  - frontend/src/components/llm-providers/llm-provider-form.tsx:840-869 引擎单选 select（aria-label「Agent 种类」）改为 Checkbox.Group 形态复选组：按 AGENT_KIND_OPTIONS（llm-provider-form.tsx:65-74）逐项复选，gemini 保持 disabled 占位；集合为空时并入 submitDisabled 并提示「至少选择一个引擎」
  - pi × openai_chat 禁用前置（防 422，对齐后端组合校验口径）：api_format=openai_chat 时 pi 复选项禁用并显示禁配提示（沿用 llm-provider-form.tsx:946-951 文案口径）；apiFormat 切到 openai_chat 时若 pi 已勾选则自动摘除；提交兜底 piOpenaiChatError（llm-provider-form.tsx:753-756）改集合判定（pi ∈ agentKinds 且 apiFormat=openai_chat）
  - 引擎条件区改集合口径：引擎自动压缩区渲染条件 agentKind 为 claude（llm-provider-form.tsx:1273）改 agentKinds.includes("claude")；pi 认证字段分支（llm-provider-form.tsx:1020-1023）与 pi base_url 端点提示（llm-provider-form.tsx:979）改 includes("pi")；pi 被摘除且 authField 不在 claude 两选项内时归一回 ANTHROPIC_AUTH_TOKEN（沿用 llm-provider-form.tsx:849-854 先例）
  - 收缩引擎默认空缺提示（R-05/D-003）：编辑态提交对比 initial.agent_kinds 与新集合，initial 为默认行且被移除引擎非空 → 保存成功后提示「X 引擎默认供应商已空缺，不会自动转移」；实现通道为表单计算收缩引擎清单、经 onSubmit 透传由 frontend/src/components/llm-providers/llm-provider-list.tsx:91-108 handleSubmit 成功分支 notify.warning 呈现（或表单内 notice，二选一）
  - frontend/src/components/llm-providers/llm-provider-form.tsx:365-380 handleSubmit 产出的 values 以 agent_kinds 键携带引擎数组（提交前去重）
  - frontend/src/components/llm-providers/llm-provider-list.tsx:229 单徽标 Badge 改为按 p.agent_kinds 逐引擎多徽标横向排布（flex-wrap，样式沿用现有 Badge warning 变体）
acceptance:
  - 新建/编辑表单引擎区可同时勾选 claude/codex/pi（gemini 仍 disabled 占位），全不勾时提交被禁用且有「至少选择一个引擎」提示
  - api_format=openai_chat 时 pi 复选项禁用并显示禁配提示；pi 勾选态下切 openai 格式自动摘除 pi；提交兜底按集合口径拦截（文案与后端 422 同口径）
  - 编辑默认行收缩引擎（如去掉 pi）保存成功后出现「pi 引擎默认供应商已空缺」类提示（R-05，不自动转移）
  - 列表行按 agent_kinds 渲染多个引擎徽标（claude+pi 行可见两个并列徽标）
verify:
  - cd frontend && pnpm dev → 浏览器手动冒烟：新建表单多选提交、openai 格式 pi 禁用、编辑默认行收缩出空缺提示、列表多徽标（tsc 门随 task-09 类型化收口，vitest 门归 task-10）
constraints:
  - 不改 frontend/src/lib/api/llm-providers.ts（LlmProviderFormValues/formToCreate/formToUpdate 的 agent_kinds 化归 task-09），本卡完成窗口 tsc 允许暂红
  - 预设 frontend/src/config/llmProviderPresets.ts 无 agent_kind 字段，零改动（design 总体方案 Wave2 第 8 条，不得引入）
  - 不改后端与 daemon 仓；不新增/重写测试用例（前端测试归 task-10，既有表单/列表用例因控件形态变化暂红可接受）
  - gemini 维持 disabled 占位，引擎词表沿用 claude/codex/pi；「至少勾一」仅前端拦截，词表校验由后端兜底
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
