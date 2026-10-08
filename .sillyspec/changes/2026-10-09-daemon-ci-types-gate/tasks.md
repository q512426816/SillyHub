---
author: flow-machine-draft
created_at: 2026-10-08T23:41:47.398Z
---
# 任务注册表（Tasks）— 2026-10-09-daemon-ci-types-gate

- [ ] task-01: daemon-ci.yml 在 Install 后、Typecheck 前新增「api-types drift check」步骤跑 pnpm gen:types:check
- [ ] task-02: 守门语义正确：仓库生成物与 openapi.json 不一致时 CI 红（exit 1），一致时零影响
- [ ] task-03: 当前仓库实测该步骤绿（刚重生成过，diff 干净）
