---
author: qinyi
created_at: 2026-09-10 23:05:00
---
# 任务清单（Tasks）

> brainstorm 展开版；plan 阶段重写为 Wave+TaskCard（含 4 条 Grill plan 约束：writePiDir 统一 Promise/Update 侧 service 层校验/写失败含 env 一并跳过/清单禁配文字同步）。

## Wave 1：codex 写盘器

- [ ] task-01: codex-settings.ts——per-session CODEX_HOME 写盘器（per-form 映射/保守合并/wire_api=responses/失败跳过含 env）

## Wave 2：pi 写盘器

- [ ] task-02: pi-settings.ts——per-session PI_CODING_AGENT_DIR 三文件（官方形状/golden/preserve unknown/base_url 门控） (depends_on: task-01)

## Wave 3：接线与热切换

- [ ] task-03: 两接线点分派（daemon.ts interactive + task-runner.ts batch）+ applyClaudeSettings kind 守卫 (depends_on: task-01, task-02)
- [ ] task-04: PROVIDER_CONFIG_CHANGED 按会话精准重写 + per-session 目录生命周期（创建/清理） (depends_on: task-03)

## Wave 4：backend 词表与前端

- [ ] task-05: schema agent_kind 增 codex（仅 Create）+ pi×openai_chat 禁配（Create 422 + Update service 层） (depends_on: task-01)
- [ ] task-06: 前端表单（codex 选项/pi 端点字段/openai_chat 禁选）+ gen:types 联动 (depends_on: task-05)

## Wave 5：冒烟收尾

- [ ] task-07: 真实 CLI 冒烟（mock 端点 codex/pi/litellm 三条）+ 模块文档 (depends_on: task-03, task-04, task-05, task-06)
