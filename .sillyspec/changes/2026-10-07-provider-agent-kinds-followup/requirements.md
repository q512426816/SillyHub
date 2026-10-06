---
author: flow-machine-draft
created_at: 2026-10-06T23:05:38.553Z
---
# 需求规格（Requirements）— 2026-10-07-provider-agent-kinds-followup

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: 前端 formToUpdate 产出的 PATCH body 携带 agent_kinds（编辑引擎复选集合真正提交），frontend/src/lib/api/__tests__/llm-providers.test.ts formToUpdate 用例补断言覆盖

- `formToUpdate()` 产出的 PATCH body **必须**携带 `agent_kinds` 键（透传 `FormValues.agent_kinds`），**禁止**遗漏该键使后端按「不传=不动」静默保留旧引擎集合——2026-10-06-provider-multi-agent-kind（commit 0b13d5e06）遗漏该字段导致编辑态引擎复选组完全无效，且 R-05 收缩提示（commit 177dea0e0）与服务器实际状态相反。

#### 场景：主路径

- Given：编辑表单引擎集合初值 ["claude","pi"]，用户取消 pi 勾选（变 ["claude"]）并提交
- When：`formToUpdate(values)` 构造 PATCH body 经 `updateProvider` 发送
- Then：body 含 `agent_kinds: ["claude"]`，后端行集合更新为 ["claude"]，刷新列表徽标与提交一致

### FR-02: 后端 LlmProviderUpdate 显式 agent_kinds=null 等同「不动」：openai_chat 行传 null 不抛 TypeError、不写 NULL、集合不变，backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py 补用例覆盖

- `LlmProviderService.update` 对显式 `agent_kinds=None`（openapi 契约 anyOf 允许 null）**必须**按「不动」处理——与同 DTO 的 `api_key`/`multimodal` 既有 None-pop 防护同款；**禁止**让 None 进入 pi×openai 生效组合判定（`"pi" in None` → TypeError 500）或 `setattr` 写 NOT NULL 列（IntegrityError 500）。

#### 场景：主路径

- Given：已存在 `api_format="openai_chat"`、`agent_kinds=["claude","codex"]` 的供应商行
- When：`update` 收到 `LlmProviderUpdate(agent_kinds=None)`（显式 null，exclude_unset 含该键）
- Then：不抛异常，返回行的 `agent_kinds` 仍为 ["claude","codex"]，DB 值不变

### FR-03: 定向测试绿：后端 llm_provider 域相关测试 + 前端 llm-providers 表单/api 域测试，tsc 与 eslint（改动文件）0 error

- 收口前定向测试**必须**全绿：后端 `backend/app/modules/llm_provider/tests/` 相关测试文件、前端 llm-providers api/表单域测试文件，及前端 `tsc` 0 error、eslint 对改动文件 0 error；**禁止**跑全量测试（CLAUDE.md 规则 0，全量留给 CI）。

#### 场景：主路径

- Given：task-01/02 实现与测试就位
- When：定向执行后端 pytest（llm_provider 域）+ 前端 vitest（llm-providers 域）+ tsc/eslint（改动文件）
- Then：全部退出码 0，无跳过的失败用例

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/api/__tests__/llm-providers.test.ts「formToUpdate — agent_kinds 透传到 PATCH body（编辑引擎集合真正提交）」
FR-02: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「update 显式 agent_kinds=null 等同不动（openai_chat 行不抛 TypeError/不写 NULL）」
FR-03: CLI 亲测/backend+frontend 定向域「pytest llm_provider 域 + vitest llm-providers 域 + tsc/eslint 改动文件 0 error」
