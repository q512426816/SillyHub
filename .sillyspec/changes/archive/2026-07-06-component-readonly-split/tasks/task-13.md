---
id: task-13
title: 端到端验证（SillyHub /components 显 5 一级子项目）+ 模块文档同步 + quicklog 收尾
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-12]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - .sillyspec/quicklog/QUICKLOG-qinyi.md
  - docs/architecture/modules/workspace.md
goal: >
  W3 收尾：端到端验证 SillyHub 重新 generate_projects 后 /components 显示 5 个一级子项目（只读无出入边无重新扫描）；create-change 选组件正常；变更详情"影响组件"正确；同步模块文档 + 写 quicklog。
implementation:
  - 部署环境对 SillyHub 实跑 generate_projects（重生 yaml），确认 projects/*.yaml 只剩 5 个
  - 访问 `/workspaces/{SillyHub}/components` 页：验证显示 5 个一级子项目、只读、无出入边、无重新扫描按钮
  - create-change 选组件候选源正常，提交后变更详情"影响组件"显示正确（affected_components 字符串链路）
  - 同步模块文档 `docs/.../modules/workspace.md`：记录组件只读化、relations 移除、catalog service
  - 写 quicklog（QUICKLOG-qinyi.md）：ql-20260706-008 记录本次变更要点与遗留
acceptance:
  - 端到端三场景（components 页 / create-change / 变更详情）全部通过
  - 模块文档已更新组件只读化章节
  - quicklog 已追加条目
verify:
  - 手动端到端（部署后浏览器验证三场景）
  - cd backend && python -m pytest tests/modules/workspace/ tests/modules/change/ -q
constraints:
  - 端到端需真实部署环境（容器内 PG，参考 memory docker-localhost-ipv6-use-127-0.0.1）
  - 模块文档同步遵循 scan 重生格式（参考 memory scan-regenerates-module-docs）
  - 若端到端发现 W1/W2 遗漏，回退对应 task 修，不在此堆补丁
---

