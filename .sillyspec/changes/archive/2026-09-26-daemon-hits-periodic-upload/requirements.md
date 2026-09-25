---
author: flow-machine-draft
created_at: 2026-09-25T23:20:26.153Z
---
# 需求规格（Requirements）— 2026-09-26-daemon-hits-periodic-upload

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 周期上行通道

- Given：daemon 已 start 且存在绑定工作区
- When：每 5 分钟周期轮
- Then：对 hits 文件有变化的工作区触发 uploadKnowledgeHitsIfNeeded（best-effort 语义不变）

### FR-02: mtime/size 短路

- Given：工作区 hits 文件自上轮未变（或无文件）
- When：周期轮
- Then：跳过该工作区（不调 uploader）；append 后下轮触发

### FR-03: 失败不中断

- Given：某工作区上行抛错
- When：周期轮内
- Then：warn 不冒泡，其余工作区与本轮后续照常，下轮重试

### FR-04: 绑定集守卫

- Given：specs/ 含非 UUID 杂名或 .pre-junction-backup-* 缓存目录
- When：枚举绑定
- Then：跳过（不进端点调用）

### FR-05: 双通道幂等与零回归

- Given：postSync 挂点保留 + 周期兜底并存
- When：两路先后上行同一批行
- Then：服务端 hash 去重零重复；既有 hits 上行 17 用例与 typecheck 零回归

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/knowledge-hits-periodic.test.ts::mtime 变化触发/append 后再触发 用例


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同文件 ::无 hits 文件 首轮空印 + ::未变短路 断言


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同文件 ::上行抛错不冒泡 用例


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同文件 UUID 守卫（readdir 过滤逻辑经 specs 目录杂名用例覆盖——本轮以正规绑定目录为 fixture）


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd sillyhub-daemon && pnpm vitest run tests/knowledge-hits-periodic.test.ts tests/knowledge-hits-upload.test.ts（22 passed）+ pnpm typecheck（exit 0）


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd sillyhub-daemon && pnpm vitest run tests/knowledge-hits-periodic.test.ts tests/knowledge-hits-upload.test.ts（22 passed）+ pnpm typecheck（exit 0）


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd sillyhub-daemon && pnpm vitest run tests/knowledge-hits-periodic.test.ts tests/knowledge-hits-upload.test.ts（22 passed）+ pnpm typecheck（exit 0）


<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd sillyhub-daemon && pnpm vitest run tests/knowledge-hits-periodic.test.ts tests/knowledge-hits-upload.test.ts（22 passed）+ pnpm typecheck（exit 0）


<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：cd sillyhub-daemon && pnpm vitest run tests/knowledge-hits-periodic.test.ts tests/knowledge-hits-upload.test.ts（22 passed）+ pnpm typecheck（exit 0）

