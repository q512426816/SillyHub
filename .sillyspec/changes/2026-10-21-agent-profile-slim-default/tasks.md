---
author: flow-machine-draft
created_at: 2026-10-21T04:10:58.640Z
---
# 任务注册表（Tasks）— 2026-10-21-agent-profile-slim-default

- [x] task-01: 后端默认档案存储与端点——alembic 迁移加 users.default_agent_profile_id（FK SET NULL）、User 模型字段、profile set-default/unset-default 端点（可见性校验）、Read.is_user_default、Create.provider 缺省 'claude'——验证：pytest profile router/service 新用例绿
- [x] task-02: 后端默认注入——inject_gates 未显式选档案时查用户默认（软偏好静默回落）、shadow.py 影子懒建群主默认注入；两处均走既有 apply_session_profile_to_lease——验证：session/group 注入用例绿（无默认零回归用例同步）
- [ ] task-03: daemon 技能严格挂载——pruneSkillsToSubset 导出共享、interactive skillsStep 尾部按 strict skillRefs 裁剪（键缺失=不裁剪、空数组=清空、非空=子集）、batch task-runner 读取点 strict 化（不动通用 pickStrList）——验证：daemon vitest 新用例（空清空/无键全量/子集）绿
- [ ] task-04: 前端表单瘦身——agent-profile-form.tsx 仅 名称/可见范围/系统提示词/技能勾选，删工作区上下文选择器与被删字段，右栏预览与 AgentProfileSelect label 同步简化——验证：表单测试（四字段/存量编辑清空引用/无 ws 选择器）绿 + tsc 零错
- [ ] task-05: 前端设为默认——lib set/unset-default API 与 is_user_default 类型、卡片设为默认/取消默认按钮+默认标记+空技能默认警示文案——验证：卡片与 lib 测试绿
- [ ] task-06: 收口前全量对账——FR 五条逐条核对实现与测试绑定、daemon+backend+frontend 三端相关测试面全绿、diff 声明面与文件清单一致（llm_provider 零触碰）——验证：三端测试面全绿
