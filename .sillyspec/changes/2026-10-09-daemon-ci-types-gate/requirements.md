---
author: flow-machine-draft
created_at: 2026-10-09T18:35:00.000Z
---
# 需求规格（Requirements）— 2026-10-09-daemon-ci-types-gate

## 功能需求

### FR-01: daemon-ci 在 Install 后、Typecheck 前跑 pnpm gen:types:check 漂移守门

- daemon-ci.yml 必须新增「api-types drift check」步骤（`pnpm gen:types:check`，重生成 + git diff --exit-code），生成物与 backend/openapi.json 不一致时 CI 必须红。

#### 场景：后端改契约未重生成 daemon 类型

- Given backend/openapi.json 变更而 sillyhub-daemon/src/api-types.ts 未跟着重生成（2026-10-09 实证：dump 端点 +113 行漂移）
- When daemon-ci 运行
- Then gen:types:check 重生成后 diff 非空 → exit 1 → CI 红，漂移被当场拦截

### FR-02: 触发路径包含 backend/openapi.json（漂移源头）

- daemon-ci 的 push/pull_request 触发 paths 必须在 sillyhub-daemon/** 之外加 `backend/openapi.json`——后端独改契约时守门也要跑，否则守门只在 daemon 同改时生效、漏掉纯后端漂移场景。

#### 场景：后端独改触发

- Given 仅 backend/openapi.json 变更的提交
- When push
- Then daemon-ci 被触发并执行 drift check

### FR-03: 当前仓库守门实测绿（生成物同步提交）

- 本变更必须一并提交重生成后的 sillyhub-daemon/src/api-types.ts（追赶 dump 端点漂移），提交后本地重跑 gen:types:check 必须 exit 0；daemon tsc --noEmit 必须 0 error。

#### 场景：绿态交付

- Given 生成物 + 守门同提交
- When 本地 pnpm gen:types:check
- Then exit 0（diff 空）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon pnpm gen:types:check「守门红态实证——旧提交面重生成 diff +113 即 exit 1（已实测）；CI 接线后同语义上流水线」
FR-02: test/.github/workflows/daemon-ci.yml「paths 含 backend/openapi.json（push/pull_request 双处，diff 可证）」
FR-03: test/sillyhub-daemon pnpm gen:types:check「提交后重跑 exit 0 + tsc --noEmit 0 error（已实测）」
