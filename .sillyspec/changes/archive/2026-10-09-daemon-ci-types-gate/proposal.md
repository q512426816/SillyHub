---
author: flow-machine-draft
created_at: 2026-10-08T23:41:47.398Z
---
# 提案书（Proposal）— 2026-10-09-daemon-ci-types-gate

## 动机

任务原话转写：动机：2026-10-09 风险审查发现 sillyhub-daemon/src/api-types.ts 落后 backend/openapi.json 多轮契约（RBAC 72→58 死键残留 + 知识图谱端点缺失）而 CI 无任何守门——gen:types:check 脚本已存在（重生成 + git diff --exit-code）但 daemon-ci.yml 未接，类型债会静默复发。

成功标准：
- daemon-ci.yml 在 Install 后、Typecheck 前新增「api-types drift check」步骤跑 pnpm gen:types:check
- 守门语义正确：仓库生成物与 openapi.json 不一致时 CI 红（exit 1），一致时零影响
- 当前仓库实测该步骤绿（刚重生成过，diff 干净）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. daemon-ci.yml 在 Install 后、Typecheck 前新增「api-types drift check」步骤跑 pnpm gen:types:check
2. 守门语义正确：仓库生成物与 openapi.json 不一致时 CI 红（exit 1），一致时零影响
3. 当前仓库实测该步骤绿（刚重生成过，diff 干净）

## 成功标准（可验证）

1. daemon-ci.yml 在 Install 后、Typecheck 前新增「api-types drift check」步骤跑 pnpm gen:types:check
2. 守门语义正确：仓库生成物与 openapi.json 不一致时 CI 红（exit 1），一致时零影响
3. 当前仓库实测该步骤绿（刚重生成过，diff 干净）
