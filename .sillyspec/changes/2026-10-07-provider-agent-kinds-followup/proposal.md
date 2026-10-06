---
author: flow-machine-draft
created_at: 2026-10-06T23:05:38.553Z
---
# 提案书（Proposal）— 2026-10-07-provider-agent-kinds-followup

## 动机

任务原话转写：修复 2026-10-06-provider-multi-agent-kind 两处收尾缺陷：编辑供应商时引擎集合改动静默丢失（formToUpdate 漏发 agent_kinds，R-05 toast 提示与服务器实际状态相反）+ 后端 Update 显式 agent_kinds=null 按契约合法但会打穿 500（pi in None TypeError / NOT NULL 违反）。
成功标准：
- 前端 formToUpdate 产出的 PATCH body 携带 agent_kinds（编辑引擎复选集合真正提交），frontend/src/lib/api/__tests__/llm-providers.test.ts formToUpdate 用例补断言覆盖
- 后端 LlmProviderUpdate 显式 agent_kinds=null 等同「不动」：openai_chat 行传 null 不抛 TypeError、不写 NULL、集合不变，backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py 补用例覆盖
- 定向测试绿：后端 llm_provider 域相关测试 + 前端 llm-providers 表单/api 域测试，tsc 与 eslint（改动文件）0 error

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 前端 formToUpdate 产出的 PATCH body 携带 agent_kinds（编辑引擎复选集合真正提交），frontend/src/lib/api/__tests__/llm-providers.test.ts formToUpdate 用例补断言覆盖
2. 后端 LlmProviderUpdate 显式 agent_kinds=null 等同「不动」：openai_chat 行传 null 不抛 TypeError、不写 NULL、集合不变，backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py 补用例覆盖
3. 定向测试绿：后端 llm_provider 域相关测试 + 前端 llm-providers 表单/api 域测试，tsc 与 eslint（改动文件）0 error

## 成功标准（可验证）

1. 前端 formToUpdate 产出的 PATCH body 携带 agent_kinds（编辑引擎复选集合真正提交），frontend/src/lib/api/__tests__/llm-providers.test.ts formToUpdate 用例补断言覆盖
2. 后端 LlmProviderUpdate 显式 agent_kinds=null 等同「不动」：openai_chat 行传 null 不抛 TypeError、不写 NULL、集合不变，backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py 补用例覆盖
3. 定向测试绿：后端 llm_provider 域相关测试 + 前端 llm-providers 表单/api 域测试，tsc 与 eslint（改动文件）0 error
