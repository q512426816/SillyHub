---
author: flow-machine-draft
created_at: 2026-10-23T16:07:38.885Z
---
# 提案书（Proposal）— 2026-10-24-pi-edit-patch-synth

## 动机

任务原话转写：pi 会话的文件变更卡弹窗永远显示无补丁(pi-events.ts 设计期把 edit_patch 列为非目标):pi 的 edit 工具结果只是「Successfully replaced N blocks」确认文本、write 结果只是「Successfully wrote to」确认文本,均无 diff 数据——但 edit 入参的 edits[{oldText,newText}] 与 write 入参的 content/path 本身就是完整变更内容。实测会话 f019f0d2-247a-4e1b-b37b-98060f710bbb 第 8 轮(run 9d65f82c,490 条日志 0 条 edit_patch 行)弹窗对 agent 明明用 write 建的文件错误断言「改动未来自本轮 agent 的编辑工具」。用户裁决:根治——daemon 在 pi 工具结束时从入参合成 structuredPatch 挂 edit_patch。

成功标准：
- pi edit 工具成功结束时,daemon 从入参 edits[{oldText,newText}] 合成 structuredPatch(oldText 行→-前缀,newText 行→+前缀,行号由改后文件定位 newText 精确得出,多块按净行偏移累积),挂到 tool_result 事件 edit_patch,backend/前端零改动消费
- pi write 工具成功结束时,从入参 content 合成全 add 行 hunk(oldStart=1,newStart=1),挂 edit_patch
- 工具失败(is_error)、入参形态不符、读盘定位失败、合成补丁超 64KB 一律不附着(宁缺不伪造)
- 前端弹窗无补丁文案区分:卡片行有编辑归因(editToolNames 命中,改N次>0)时改说「改动确实来自本轮 agent 编辑工具,但该会话运行时未上报结构化补丁」,不再断言「未来自编辑工具」
- daemon 触及面 vitest 全绿 + 前端触及面 vitest 全绿 + 双侧 tsc --noEmit 零类型错误

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. pi edit 工具成功结束时,daemon 从入参 edits[{oldText,newText}] 合成 structuredPatch(oldText 行→-前缀,newText 行→+前缀,行号由改后文件定位 newText 精确得出,多块按净行偏移累积),挂到 tool_result 事件 edit_patch,backend/前端零改动消费
2. pi write 工具成功结束时,从入参 content 合成全 add 行 hunk(oldStart=1,newStart=1),挂 edit_patch
3. 工具失败(is_error)、入参形态不符、读盘定位失败、合成补丁超 64KB 一律不附着(宁缺不伪造)
4. 前端弹窗无补丁文案区分:卡片行有编辑归因(editToolNames 命中,改N次>0)时改说「改动确实来自本轮 agent 编辑工具,但该会话运行时未上报结构化补丁」,不再断言「未来自编辑工具」
5. daemon 触及面 vitest 全绿 + 前端触及面 vitest 全绿 + 双侧 tsc --noEmit 零类型错误

## 成功标准（可验证）

1. pi edit 工具成功结束时,daemon 从入参 edits[{oldText,newText}] 合成 structuredPatch(oldText 行→-前缀,newText 行→+前缀,行号由改后文件定位 newText 精确得出,多块按净行偏移累积),挂到 tool_result 事件 edit_patch,backend/前端零改动消费
2. pi write 工具成功结束时,从入参 content 合成全 add 行 hunk(oldStart=1,newStart=1),挂 edit_patch
3. 工具失败(is_error)、入参形态不符、读盘定位失败、合成补丁超 64KB 一律不附着(宁缺不伪造)
4. 前端弹窗无补丁文案区分:卡片行有编辑归因(editToolNames 命中,改N次>0)时改说「改动确实来自本轮 agent 编辑工具,但该会话运行时未上报结构化补丁」,不再断言「未来自编辑工具」
5. daemon 触及面 vitest 全绿 + 前端触及面 vitest 全绿 + 双侧 tsc --noEmit 零类型错误
