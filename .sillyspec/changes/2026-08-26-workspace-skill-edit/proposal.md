---
author: qinyi
created_at: 2026-08-26 19:32:00
---
# 提案书（Proposal）

## 动机

工作区「自定义 Skills」页只读（2026-07-07 D-006），用户无法在平台上管理自定义 skill；与刚完成的 MCP 配置编辑同等待遇缺失。

## 关键问题

1. **无编辑入口**：skill 的唯一写法是直接改服务器文件（specDir/skills/），对平台用户不可用
2. **skill 价值依赖 SKILL.md 质量**：agent 实际读的是每个 skill 的 SKILL.md，用户无法在线打磨 skill 内容与辅助文件
3. **与 MCP 能力不对齐**：同页签体系下 MCP 已可编辑，skills 仍只读，体验割裂

## 变更范围

- 后端：SkillsViewService 写路径 + 5 REST 端点（skill 建删 + 文件读/写/删），路径安全与审计
- 前端：skills 页双栏改造（skill 列表+文件树 / 文件编辑器），新建对话框与删除确认
- 类型：gen:types 重生成

## 不在范围内（Non-Goals）

- 文件重命名/移动、深层目录管理（限两层）
- 二进制文件、语法高亮/预览
- 平台级 skills 分发链路改动
- explorer 模块改动
- daemon 侧改动（spec sync 既有链路生效）

## 成功标准（可验证）

- 页面可完成：新建 skill → 编辑 SKILL.md → 新建/编辑/删除辅助文件 → 删除 skill 全流程
- 安全约束全部生效（路径穿越/白名单/二进制/超限/SKILL.md 保护各有专项测试）
- 既有只读行为回归：GET skills 列表不变；无 skills 目录空态不变
- 后端 workspace 模块与前端全量测试绿
