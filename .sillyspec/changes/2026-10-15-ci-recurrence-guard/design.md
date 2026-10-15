---
author: flow-machine-draft
created_at: 2026-10-15T00:49:32.903Z
---
# 设计记录（Design Record）— 2026-10-15-ci-recurrence-guard

## 做法概述

把 2026-10-15-fix-ci-red 灭火中归因的三类本地拦截面缺口机制化：① 断言面闸门规则⑦ requires 补齐三件套（admin/menus 序钉 + menu-permissions.test.ts 数量锚 + permission.test.ts 分区条目）——历史事故正是「只重算序钉漏数量锚」，闸门当时只盯序钉；② 新增规则⑨ openapi.json 契约源 → 前端+daemon 双 api-types 生成物同提交——规则 21 长期只写前端义务，daemon 漏生成无人记得；③ pre-push 新增 ci-fast-gate 快检（frontend/daemon typecheck + 双 gen:types:check，与 CI 同源四命令前移到推送时）。同步 CLAUDE.md 第 21 条与 knowledge/testing-gotchas.md（脚本 docstring 规定的两处同步登记）。选扩展既有闸门而非新建脚本：改契约必须同提交配对测试的防呆模式 2026-10-11 已实证有效，本次只是补规则；pre-push 而非 pre-commit 放 typecheck——每次提交跑 1 分钟太重，推送是 CI 前最后闸口。

## 接口契约

check-assertion-surfaces.py：RULES 元组新增⑨、⑦ requires 2→3（纯数据变更，evaluate 纯函数零改）；退出码语义不变。backend/.pre-commit-config.yaml：三个既有钩子显式 stages:[pre-commit]（防 pre-push 安装后双跑），新增 ci-fast-gate 与 docs-gate 两个 stages:[pre-push] 钩子；原 .git/hooks/pre-push（sillyspec docs gate 棘轮）收编为 docs-gate 配置钩子后删除 .legacy 文件，语义零改动。CLAUDE.md 第 21 条增 daemon 生成义务一条 bullet。无函数签名/端点/文件格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：不适用——闸门按 staged 面瞬时判定，无事件序依赖；openapi 先改后生成物补齐的顺序不敏感（同提交即过）。
2. 并发写：pre-commit 框架自身 stash/restore 并发防护沿用；pre-push 快检读工作树态，与并行会话共用工作树时的既有竞态面不变（docs-gate --against HEAD 按被推送提交树校验即为此设计）。另侧生成物（api-types）漂移时 ci-fast-gate 的 gen:types:check 会把再生成结果留在工作树——属预期可提交产物非脏状态。
3. 切换/生命周期：钩子 fail-closed 且 check-only（typecheck/gen:types:check 不改逻辑文件；gen:types:check 会写生成物文件，被拦后重跑生成+提交即可，无半态）。
4. 作用域：本机 .git/hooks 是机器本地安装（配置入库、安装命令留痕于注释）；其它机器/CI 不自动获得 pre-push 钩子——闸门⑦⑨在 pre-commit（已入库配置）层仍生效。多仓不串台。

## 风险与死路

最大风险：⑦ 三件套过度触发（如 ppm 区加菜单不改 permission.test.ts 的分区条目）——按既有口径走「确认不触及钉子断言则纳入评审说明」逃生门，fail-closed 优于 CI 补红。试过但放弃：把菜单数量锚改为从源常量推导（task-05 rejected）——推导锚等于断言与被测同源，钉子失去「源码长大必须显式跟」的契约语义，复发根因是本地缺拦截面而非锚形式，闸门⑦补齐已治本；另考虑过 pre-commit 阶段跑 typecheck（放弃：每次提交 1 分钟不可接受）。
