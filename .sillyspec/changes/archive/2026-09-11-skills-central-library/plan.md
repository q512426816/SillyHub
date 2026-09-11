---
author: qinyi
created_at: 2026-09-11 02:30:00
plan_level: full
---

# 实现计划（Plan）— 技能库

> full：4 task / 跨 backend+frontend / 两新表+子进程 git / bundle 组装扩展。
> decisions：D-001~D-003/005~D-011 accepted（D-004 superseded 撤销留痕）。

## Spike 前置验证
不需要（关键技术点均有源码/调研事实：bundle per-user 链路 daemon_rpc.py:383-425 Grill 实证；git 参数集 ai-toolbox 先例；SSRF 断言 core/ssrf.py:34-53）。

## Wave 1（模型+源 CRUD）

- task-01

## Wave 2（git 拉取器+发现）

- task-02

## Wave 3（绑定+library+收集第三源）

- task-03

## Wave 4（前端+生成物）

- task-04

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | skill_source 模型/迁移/源 CRUD | W1 | P0 | — | FR-01, D-002/D-007 | 两表+admin 门+SSRF+git 探测 422；迁移 down_revision 对齐实测 head（双头先 merge） |
| task-02 | git_fetcher+技能发现 | W2 | P0 | task-01 | FR-01, D-006/D-007 | clone/fetch 浅参数/300s 超时/≤200 文件 ≤10MB 上限/本地 git init 假仓测试 |
| task-03 | 绑定+library+bundle 第三源 | W3 | P0 | task-02 | FR-02/03, D-003/D-005/D-010 | enable 端点（本人）/library 聚合/collect 第三源+同名优先级矩阵+三零回归 |
| task-04 | 前端技能页+gen:types | W4 | P1 | task-03 | FR-04 | 源管理 admin 区块+技能库启用开关；我的技能现状不动 |

## 关键路径
task-01 → 02 → 03 → 04（全串行——skill_source 模块内文件共享）。

## 全局验收标准
1. backend：uv run pytest app/modules/skill_source app/modules/daemon/tests/test_skills_bundle.py -q 全绿
2. daemon 零改动：grep 零 diff（manifest 向后兼容由 agent 侧测试锁定）
3. 三零回归：无源无绑定 version hash 现状一致；sillyspec-*/CustomSkill 用例原样；未启用 git 技能零入 bundle
4. 同名优先级矩阵（三源两两撞名）+ SSRF 拒绝 + 上限跳过 + admin 403 各有测试
5. 前端：vitest 技能页相关 + tsc；gen:types 双仓零漂移
6. ruff/mypy 定向全过

## 覆盖矩阵

| ID | 覆盖任务 | 证据 |
|---|---|---|
| D-002 平台共享源 | 01 | AC-4 admin 门 |
| D-003 默认关启用 | 03 | AC-3 未启用零入 bundle |
| D-005 版本复用 | 03 | AC-3 version hash 断言 |
| D-006 subprocess git | 02 | AC-4 假仓测试 |
| D-007 安全三防线 | 01,02 | AC-4 |
| D-010 同名去重 | 03 | AC-4 矩阵 |
| D-011 收编撤销 | 范围 | — |
