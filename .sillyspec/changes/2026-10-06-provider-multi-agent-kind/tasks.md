---
author: qinyi
created_at: 2026-10-06 14:33:00
---
# 任务清单（Tasks）

- [ ] task-01: 数据迁移 agent_kind→agent_kinds JSON（双方言+存量单值转数组+索引 drop/rebuild+对称 downgrade）
- [ ] task-02: 模型/DTO agent_kinds list[str] + pi×openai_chat 集合级校验（schema+service 双口径） (depends_on: task-01)
- [ ] task-03: 服务层默认互斥逐引擎清（create/update/set_default 含扩张清新增引擎兄弟、收缩空缺） (depends_on: task-02)
- [ ] task-04: 解析链集合化（context.py resolve_default/bound/_inject_provider_config + inject_gates.py + capability.py + mcp_gateway/tools.py 池描述符） (depends_on: task-02)
- [ ] task-05: 热切换扇出 notify_provider_switch 按会话引擎分组（NULL provider 跳过告警；停止场景不变） (depends_on: task-04)
- [ ] task-06: 注释/DTO 文档串语义同步（agent/schema.py + protocol.py） (depends_on: task-04)
- [ ] task-07: 后端测试五域（llm_provider 多选/组合/互斥扩张 + 解析集合命中/盖引擎 + provider_switch 扇出含单引擎回归 + capability 门控含群聊 shadow 间接路径用例 + 迁移测试含索引在位断言） (depends_on: task-03, task-04, task-05)
- [ ] task-08: 前端表单引擎多选（Checkbox.Group + openai 禁 pi 前置 + 收缩引擎默认空缺 toast 提示）+ 列表多徽标 (depends_on: task-02)
- [ ] task-09: 前端消费面 + gen:types（api 层类型/归一化 + 配置条/档案表单过滤 includes + 移动端与全部 mock 字段 + openapi.json/api-types.ts 再生成提交） (depends_on: task-08)
- [ ] task-10: 前端测试（表单/列表/过滤口径/form-fetch-config mock）+ tsc + eslint (depends_on: task-09)
- [ ] task-11: 端到端验收——UI 实测多引擎供应商双引擎会话命中 + 设默认互斥（含扩张）+ 热切换多引擎扇出 + pi×openai 禁用 UI 复验（手动验收记录留变更目录） (depends_on: task-07, task-10)
