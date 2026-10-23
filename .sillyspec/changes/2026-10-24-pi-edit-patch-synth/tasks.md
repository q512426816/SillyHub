---
author: flow-machine-draft
created_at: 2026-10-23T16:07:38.885Z
---
# 任务注册表（Tasks）— 2026-10-24-pi-edit-patch-synth

- [x] task-01: pi edit 工具成功结束时,daemon 从入参 edits[{oldText,newText}] 合成 structuredPatch(oldText 行→-前缀,newText 行→+前缀,行号由改后文件定位 newText 精确得出,多块按净行偏移累积),挂到 tool_result 事件 edit_patch,backend/前端零改动消费
- [x] task-02: pi write 工具成功结束时,从入参 content 合成全 add 行 hunk(oldStart=1,newStart=1),挂 edit_patch
- [x] task-03: 工具失败(is_error)、入参形态不符、读盘定位失败、合成补丁超 64KB 一律不附着(宁缺不伪造)
- [x] task-04: 前端弹窗无补丁文案区分:卡片行有编辑归因(editToolNames 命中,改N次>0)时改说「改动确实来自本轮 agent 编辑工具,但该会话运行时未上报结构化补丁」,不再断言「未来自编辑工具」
- [x] task-05: daemon 触及面 vitest 全绿 + 前端触及面 vitest 全绿 + 双侧 tsc --noEmit 零类型错误
