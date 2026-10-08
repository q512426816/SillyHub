---
author: flow-machine-draft
created_at: 2026-10-08T00:36:19.669Z
---
# 需求规格（Requirements）— 2026-10-08-provider-update-models-none-guard

## 功能需求

### FR-01: service.update() 对 models 做显式 None-pop，与 agent_kinds 既有防护同款对齐

- `LlmProviderService.update()` 收到显式 `models=None`（openapi 契约 anyOf 允许 null）时**必须**按「不动」处理（从 updates 字典弹出），**禁止**让 None 进入 setattr 写到 NOT NULL 列（`model.py::LlmProvider.models` 为 `Column(JSON, nullable=False)`）。

#### 场景：显式 null 更新

- Given：某用户已有一行 provider，models 含条目 m-a
- When：`svc.update(id, user_id, LlmProviderUpdate(models=None))`
- Then：更新正常返回（无 IntegrityError），行 models 保持原列表不变

### FR-02: PATCH body models=null 不再 500，原模型列表保持不变（补回归测试覆盖）

- 显式 `models=None` 的 noop 语义**必须**有回归测试覆盖；同用例**必须**顺带断言非 None 列表仍整表替换（防护只拦 None，不得误伤 `[]` 清空/替换语义）。

#### 场景：回归用例双断言

- Given：test_agent_kinds_multi.py 既有 agent_kinds None-pop 用例同款夹具（`_create_user` + service 直调）
- When：先 `LlmProviderUpdate(models=None)` 再 `LlmProviderUpdate(models=[新列表])`
- Then：第一次后 models 原样（含重读持久层），第二次后整表替换为新列表

### FR-03: 本模块相关测试文件全绿

- 本变更触碰的测试文件（test_agent_kinds_multi.py）**必须**全绿；全量测试留给 CI（`.claude/CLAUDE.md` 规则 0）。

#### 场景：相关面验证

- Given：仅改动 llm_provider service.py 与该测试文件
- When：运行该测试文件全量用例
- Then：全部通过，无回归

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「TestMultiKindUpdateSemantics::test_explicit_null_models_is_noop」
FR-02: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「TestMultiKindUpdateSemantics::test_explicit_null_models_is_noop」
FR-03: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「全文件」
