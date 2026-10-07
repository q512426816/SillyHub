# 符号影响面报告

- task-01: 签名级变更：LlmProvider 删 model/model_role_mappings/multimodal/default_fallback_model 四列属性，加 models JSON 列。受影响调用点：schema/service/context/capability/inject_gates/create/router/litellm_client——task-02~06 范围内
- task-02: 签名级变更：LlmProviderCreate/Update/Read 删四旧字段，加 models: list[ProviderModelEntry]（新子模型类）。受影响：前端 api-types（task-09 重生成）
- task-03: 无公开签名变更（服务层内部；新增 _derive_primary_model 静态 helper 供 probe/quota/litellm 三消费点共用）
- task-04: provider_config dict 新增 models 键；model/default_fallback_model 键值改折算派生；model_role_mappings 键值改条目折算（键名形态不变，daemon 消费面零改动）
- task-05: 签名级变更：capability.resolve_gate/resolve_session_gate/attachment_pipeline.resolve_multimodal_gate/session 服务包装层新增 model_name 入参（缺省 None 向后兼容）；_PrelockedInjectAttachments 加 pre_model 字段
- task-06: 无公开签名变更（inject_gates/create 内部校验与派生；DaemonSessionConfigInvalid 422 新增文案）
- task-07: 无签名级变更（测试）
- task-08: 无签名级变更（表单 UI）
- task-09: 签名级变更（生成物）：api-types.ts 旧四字段删除、models 数组新增（gen:types 再生成）
- task-10: 无签名级变更（测试）
- task-11: 无签名级变更（手动验收记录）
