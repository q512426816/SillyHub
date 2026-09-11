---
author: qinyi
created_at: 2026-09-11 02:20:00
---
# 任务清单（Tasks）

> brainstorm 展开版（4 task/4 Wave 串行）；plan 阶段细化。

## Wave 1：数据模型+源 CRUD

- [x] task-01: skill_source 模块——模型/迁移/源 CRUD（admin 门+SSRF+git 探测）

## Wave 2：git 拉取器+发现

- [x] task-02: git_fetcher 浅克隆/更新/发现（上限/超时/本地假仓测试） (depends_on: task-01)

## Wave 3：绑定+library+收集第三源

- [x] task-03: user_skill_enables+library 端点+bundle 第三源（D-010 同名优先级+三零回归） (depends_on: task-02)

## Wave 4：前端+生成物

- [x] task-04: 技能页两新区块（源管理/技能库启用）+ gen:types (depends_on: task-03)
