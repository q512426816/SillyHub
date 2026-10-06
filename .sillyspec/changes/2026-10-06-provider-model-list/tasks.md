---
author: qinyi
created_at: 2026-10-06 21:40:00
---
# 任务清单（Tasks）

- [ ] task-01: 迁移——models JSON 列 + 存量折算回填（Python 侧四形态）+ 四旧列删除 + 对称 downgrade
- [ ] task-02: 模型/DTO——model.py 删四旧字段加 models 列；schema.py ProviderModelEntry（name/multimodal 三态/roles 值域/one_m）+ 三 DTO 退役 default_fallback_model 加 models (depends_on: task-01)
- [ ] task-03: 服务层——create/update/_to_read + probe(:358)/quota(router:151)/litellm register(:84) 三消费点切主模型派生 (depends_on: task-02)
- [ ] task-04: 注入折算——context.py 两处 resolve：两键同值（会话所选??主模型）+ model_role_mappings 折算形态逐字 + models 新键 (depends_on: task-02)
- [ ] task-05: 门控链——capability.py model_name 入参 + 三态×列表判定 + 未命中保守 false + attachments/shadow/attachment_pipeline 两调用链透传 (depends_on: task-02)
- [ ] task-06: 会话选模型——inject_gates/create 非空 ∈ 列表校验 422 + claim model 派生 (depends_on: task-04)
- [ ] task-07: 后端测试——迁移折算四形态/折算器归并（one_m 冲突取 true 优先，plan 写死）/服务层/注入契约逐字/门控三态×命中×群聊链/选模型 422 (depends_on: task-03, task-04, task-05, task-06)
- [ ] task-08: 前端模型列表编辑器——行内 name/三态下拉/角色标签/one_m/删行 + 添加 + fetch 一键加入；旧 4 槽 UI 退役 (depends_on: task-02)
- [ ] task-09: 前端消费面——api 类型/FormValues/配置条模型下拉源/档案表单/ctx-usage-bar/列表卡片/session-panel/page-helpers/移动端 + gen:types + 四旧字段 grep 清零 (depends_on: task-08)
- [ ] task-10: 前端测试 + tsc + eslint (depends_on: task-09)
- [ ] task-11: 端到端验收——存量折算回显/加模型标角色/开会话选模型/附件门控按标记/选列表外 422（手动验收记录留变更目录） (depends_on: task-07, task-10)
