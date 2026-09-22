---
author: qinyi
created_at: 2026-09-22 11:25:23
---
# 提案书（Proposal）

## 动机

平台交互会话目前只有整会话恢复（reopen/SESSION_RESUME），无法从历史某一轮"回头"开分支。用户需要在正常会话中回到之前某个时间点、换个方向继续对话（原会话不受影响）；同时肥会话续接（sillyspec handoff 场景）的前置原子能力——"带着截至某点的前缀上下文开新会话"——也缺这一块地基。Claude Agent SDK 已原生具备任意点分叉能力（resumeSessionAt + forkSession）但平台零使用，本变更把它接通并按引擎能力分档推广到全部会话。

## 关键问题

1. **无分叉能力**：会话走岔了只能重开空会话重述前情，或忍受越来越肥的上下文继续——回到第 N 轮试另一种问法这一基本操作不存在。
2. **引擎能力不齐且未显式声明**：claude 有 SDK 原生任意点截断恢复，codex/pi 只能整会话恢复——平台没有能力位表达"哪个引擎能怎么分叉"，前端也无从门控。
3. **选点缺数据锚**：UI 选点粒度是"轮"（AgentRun），但引擎侧定位需要消息级锚点（claude chain-entry UUID），平台未落库该映射，原生分叉无从谈起。

## 变更范围

- backend：AgentSession fork 三列 + origin='fork'、AgentRun engine_anchor 锚点列与回填；POST /sessions/{id}/fork 端点（native 档走既有 create-with-resume 管道透传 SDK fork 参数，seed 档组装前情转述种子）；caps 镜像 16 键。
- sillyhub-daemon：PROVIDER_CAPS 第 16 键 sessionFork（native/seed/none 枚举）+ 生成器支持 + CreateSessionInput/driver 参数透传（claude driver 接 resumeSessionAt/forkSession；pi 视 spike 结果接原生 fork）。
- frontend：轮级「从此分叉」入口+确认弹层（档位语义标注）、分叉会话溯源块+谱系面包屑、原会话浮层（WorkerSessionOverlay 泛化）、会话列表分叉徽标与附属分组。
- Wave1 双 spike：pi fork 截断语义实测、claude resumeSessionAt×forkSession 组合真机验证，结论落 D-008 定档。

## 不在范围内（显式清单）

- 不做 handoff 自动续接（阶段边界机械切窗、触发器、sillyspec CLI --json 种子字段）——后置独立变更（D-006）
- 不做原会话冻结/只读（分叉后 A 保留可继续，D-005）
- 不做轮内消息级分叉（粒度=轮边界，D-003）
- 不做分支可视化画布（树形图/canvas）
- 不改既有 resume/reopen 整会话恢复语义
- 不做 A/B 并发写防护（既有风险面，风险登记 R-04 留痕）

## 成功标准（可验证）

- claude 会话在第 N 轮分叉后：新会话 B 能正确回答第 1~N 轮上下文内的问题，且对第 N+1 轮及之后的内容完全不知情（真机 E2E 断言）
- 分叉动作前后源会话 A 的所有数据库字段零变化（pytest 断言），A 可继续正常对话
- codex（及 pi 若 spike 失败）会话可分叉，新会话以标注「前情转述」的种子启动，体积受 FORK_SEED_MAX_CHARS 帽约束
- cursor 会话（caps none）不出现分叉入口；直接调 API 返回 422
- caps=none 引擎、进行中轮、锚点缺失轮的拦截各有测试覆盖；既有 resume/reopen/inject 回归全绿
- 未分叉用户的既有行为与 API 响应零变化（新列全可空、新端点独立）
