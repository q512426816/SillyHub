---
author: flow-machine-draft
created_at: 2026-10-23T16:07:38.885Z
---
# 需求规格（Requirements）— 2026-10-24-pi-edit-patch-synth

## 功能需求

### FR-01: pi edit 成功结束时从入参合成补丁

- pi 的 `edit` 工具成功结束时（is_error=false），daemon **必须**从该调用入参 `edits[{oldText,newText}]` 合成 structuredPatch（`oldText` 行加 `-` 前缀、`newText` 行加 `+` 前缀；`newStart` 由改后文件顺序定位 `newText` 得出，多块从前块结束位向后搜且按净行偏移累积 `oldStart`），挂到 tool_result 事件的 `edit_patch`（backend 透传、前端 parseStructuredPatch 直接消费，双侧零改动）；定位失败/形态不符 **必须** 整体放弃（不附着，宁缺不伪造）。

#### 场景：单块替换

- Given edit 入参 `edits:[{oldText:"a\nb",newText:"a\nc"}]`、工具成功、改后文件含 `a\nc`，When 合成，Then `edit_patch=[{oldStart:<定位行>,newStart:<定位行>,lines:["-a","-b","+a","+c"]}]`（行号精确）。

#### 场景：多块替换

- Given 同一文件两块 edits（第二块使文件净减 2 行），When 合成，Then 两 hunk 各自 newStart 定位精确、第二块 oldStart = newStart + 2（累积偏移），hunk 间前端渲染 `…` 分隔。

### FR-02: pi write 成功结束时合成全新增 hunk

- pi 的 `write` 工具成功结束时，daemon **必须**从入参 `content` 合成全 add 行 hunk（`oldStart=1,newStart=1,lines=[content 逐行 "+" 前缀]`）挂 `edit_patch`（覆盖写旧行不可知，全 add 是如实口径——前端展示"写入后全文"）。

#### 场景：新建文件

- Given write 入参 content="x\ny\n" 且工具成功，When 合成，Then `edit_patch=[{oldStart:1,newStart:1,lines:["+x","+y","+"]}]`。

### FR-03: 失败/超限一律不附着

- 工具失败（is_error=true）、入参形态不符（edits 非数组/块缺 oldText 或 newText 非字符串/write 无 content）、读盘失败、`newText` 在改后文件定位不到、合成补丁 JSON 超 64KB——**必须** 一律不附着 `edit_patch`（保持现状，不伪造行号不截半补丁）。

#### 场景：定位失败放弃

- Given edits 的 newText 与盘面不一致（并发他进程已改），When 合成，Then edit_patch 不附着，弹窗维持无补丁文案（不猜行号）。

### FR-04: 弹窗文案区分"agent 改过但无补丁"

- 前端 TurnFileDiffDialog 无补丁时 **必须** 按文件行编辑归因区分文案：该文件有编辑归因（快照 editToolNames 命中、卡片"改N次"N>0）→ 显示"改动确实来自本轮 agent 的编辑工具，但该会话运行时未上报结构化补丁，无法展示行级 diff；行数统计可信"；无编辑归因 → 维持现有"未来自编辑工具"文案。**禁止** 对 agent 编辑过的文件断言"未来自编辑工具"。

#### 场景：pi 历史轮次（存量无补丁数据）

- Given pi 会话历史轮次（daemon 升级前，日志无 edit_patch）文件行"改1次"，When 点开弹窗，Then 显示"确实来自 agent 编辑但运行时未上报结构化补丁"文案，不再错误甩锅命令行。

### FR-05: 触及面测试与类型零错

- daemon 触及面（pi-events + 新合成模块）与前端触及面（弹窗）vitest **必须** 全绿；双侧 `tsc --noEmit` **必须** 零类型错误。

#### 场景：验收门

- When 运行触及面 vitest 与双侧 tsc --noEmit，Then 全部通过、零错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts「edit 单块合成(行号定位精确)」+「edit 多块合成(顺序定位+偏移累积)」
FR-02: sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts「write 全新增 hunk 合成」
FR-03: sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts「失败/形态不符/定位失败/64KB 超限一律不附着」
FR-04: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「agent 编辑过但无补丁的区分文案」
FR-05: 双侧触及面 vitest 全绿 + sillyhub-daemon/frontend 各自 tsc --noEmit 零错（实测回执）
