---
author: flow-machine-draft
created_at: 2026-09-25T09:50:43.826Z
---
# 需求规格（Requirements）— 2026-09-25-daemon-hits-upload-fingerprint

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 断点状态记录行指纹

- Given：`.hits-upload-state-{wsId}.json` 持久化上行断点
- When：每批 `postKnowledgeHitsBatch` 成功后
- Then：状态原子写为 `{uploadedLines, tailHash, updated_at}`，`tailHash` = 已上行最后一行的 sha256（uploadedLines=0 时为 null）

### FR-02: 替换检测与全量自愈重报

- Given：hits 文件被重置/替换后重新长回或超过旧 offset（行数口径看不出异常）
- When：下一轮上报前做指纹比对，发现「已上行最后一行」位置已是别的行
- Then：回退 offset=0 从头重报全部完整行；服务端 (workspace_id, line_hash) 唯一约束幂等去重，新文件前段不再被静默跳过

### FR-03: 钳位语义不变

- Given：状态行数超前于当前文件（外部截断）
- When：钳位分支执行
- Then：钳位轮零上行、立即固化断点，并随钳位重记指纹（行为与既有用例钉住的一致）

### FR-04: legacy 状态零误伤

- Given：旧 daemon 写的 `{uploadedLines, updated_at}`（无 tailHash）
- When：新代码读取该状态
- Then：该轮维持纯行数口径不整文件重报；首批成功后 tailHash 开始落盘，次轮起具备替换检测

### FR-05: 单测覆盖三态

- Given：替换后长过旧 offset、等长替换、legacy 状态三种形态
- When：跑 `tests/knowledge-hits-upload.test.ts`
- Then：分别断言：全量重报且后续恢复增量 / 等长替换识别重报 / legacy 只报增量且状态落 tailHash

### FR-06: 零回归

- Given：既有 14 个 hits 上行用例
- When：定向跑 `pnpm vitest run tests/knowledge-hits-upload.test.ts`
- Then：全部通过（当前 17 passed = 基线 14 + 新 3）

### FR-07: 类型检查零错

- Given：daemon 工程 `tsc --noEmit`（含 noUncheckedIndexedAccess 严格索引）
- When：跑 `pnpm typecheck`
- Then：exit 0（无类型错误）
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: 断点状态在行数之外记录 tailHash（已上行最后一行的 sha256）
FR-02: 每批成功后随行数一起原子落盘
FR-03: 每轮上报前做指纹比对：行数未超前但「已上行最后一行」位置已是别的行 → 回退 offset=0 从头重报（服务端 hash 去重兜底），新文件前段不再被静默跳过
FR-04: 钳位分支（行数超前）语义不变：钳位轮零上行、立即固化，并随钳位重记指纹
FR-05: legacy 状态（无 tailHash）零误伤：该轮维持纯行数口径不整文件重报，首批成功后指纹开始落盘
FR-06: 新增单测：替换后长过旧 offset 全量重报+后续恢复增量、等长替换识别、legacy 状态不误报且指纹落盘
FR-07: 既有 hits 上行单测零回归（基线 14）+ pnpm typecheck 0 错
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/knowledge-hits-upload.test.ts::legacy 状态用例（断言状态文件落 tailHash= 已上行最后一行 sha256）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/knowledge-hits-upload.test.ts::文件被重置替换后长回/超过旧 offset 用例（全量重报 + 恢复增量两段断言）


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/knowledge-hits-upload.test.ts::「offset 超前（外部截断）」既有用例（零上行 + append 后续走）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/knowledge-hits-upload.test.ts::legacy 状态（无 tailHash）用例（只报第 2 行 + tailHash 落盘断言）


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/knowledge-hits-upload.test.ts 三个新用例（替换长回 / 等长替换 / legacy）


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/knowledge-hits-upload.test.ts 全套（17 passed = 基线 14 + 新 3）


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向命令 cd sillyhub-daemon && pnpm typecheck（exit 0）

