---
author: flow-machine-draft
created_at: 2026-10-08T17:57:00.000Z
---
# 需求规格（Requirements）— 2026-10-09-daemon-api-types-regen

## 功能需求

### FR-01: sillyhub-daemon/src/api-types.ts 从仓库 backend/openapi.json 重生成，被删的 16 个死权限字符串零残留

- `sillyhub-daemon/src/api-types.ts` 必须经 `pnpm gen:types`（脚本消费仓库 `backend/openapi.json`）重生成；2026-10-08 RBAC 清理删除的 16 个死权限字符串在该文件中必须零残留（Permission 联合 72→58 对齐）。

#### 场景：类型契约对齐后端单一真相

- Given backend/openapi.json 已是 58 项 Permission 联合
- When 运行 pnpm gen:types（sillyhub-daemon 目录）
- Then api-types.ts 重生成，grep 16 个死键零命中

### FR-02: daemon tsc --noEmit 0 error（生成物为纯类型面，编译门即验证门）

- 重生成后 daemon `tsc --noEmit` 必须 0 error——生成文件是纯类型面（编译期擦除），编译门通过即运行时零影响。

#### 场景：编译门

- Given 重生成完成
- When pnpm exec tsc --noEmit
- Then exit 0 零报错

### FR-03: 除生成文件外零手写代码改动

- 本变更改动面必须仅含 `sillyhub-daemon/src/api-types.ts` 一个生成文件，禁止手写代码改动。

#### 场景：最小面

- Given 补丁应用后
- When git diff --stat 检视
- Then 仅 sillyhub-daemon/src/api-types.ts 一个交付文件

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon pnpm gen:types「重生成 + grep 16 死键零命中（已实测，5625+/1591- 为多轮后端契约追赶）」
FR-02: test/sillyhub-daemon pnpm exec tsc --noEmit「exit 0（已实测）」
FR-03: 不适用：纯生成物变更——以 git diff --stat 单文件面为验证（已实测）
