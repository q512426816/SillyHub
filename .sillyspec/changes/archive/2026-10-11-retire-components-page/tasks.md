---
author: flow-machine-draft
created_at: 2026-10-11T03:59:27.322Z
---
# 任务注册表（Tasks）— 2026-10-11-retire-components-page

- [x] task-01: 工作区详情不再出现「项目组件」入口与页面（桌面 + 移动端子页均移除）
- [x] task-02: 后端零改动（components 端点保留，openapi/api-types 零变化，不破坏任何既有调用方）
- [x] task-03: 前端对已删页面的引用（导航/链接/测试/类型引用）全部清理，无死链
- [x] task-04: 仅跑改动相关测试 + typecheck/lint 绿，全量留给 CI
