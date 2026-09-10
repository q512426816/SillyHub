---
author: qinyi
created_at: 2026-09-10 23:05:00
---
# 任务清单（Tasks）

> plan 展开版（7 task/5 Wave）；分组与依赖见 plan.md 任务总表。

## Wave 1：codex 写盘器

- [ ] task-01: codex-settings.ts——per-session CODEX_HOME 写盘器（per-form 映射/保守合并/失败跳过含 env）

## Wave 2：pi 写盘器

- [ ] task-02: pi-settings.ts——per-session PI_CODING_AGENT_DIR 三文件写盘器 (depends_on: task-01)

## Wave 3：接线与热切换

- [ ] task-03: 两接线点分派 + applyClaudeSettings kind 守卫 (depends_on: task-01, task-02)
- [ ] task-04: 热切换按会话重写 + per-session 目录生命周期 (depends_on: task-03)

## Wave 4：backend 词表与前端

- [ ] task-05: schema codex 词表 + pi×openai_chat 禁配（Create 422 + Update service 层）
- [ ] task-06: 前端表单（codex 选项/pi 端点字段/openai_chat 禁选）+ gen:types 联动 (depends_on: task-05)

## Wave 5：冒烟收尾

- [ ] task-07: 真实 CLI 冒烟（mock 三条）+ api-types 零漂移 + 模块文档 (depends_on: task-03, task-04, task-05, task-06)
