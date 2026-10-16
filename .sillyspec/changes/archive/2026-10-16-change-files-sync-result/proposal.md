---
author: flow-machine-draft
created_at: 2026-10-16T07:50:41.181Z
---
# 提案书（Proposal）— 2026-10-16-change-files-sync-result

## 动机

任务原话转写：动机：change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5s 同步耗时（fire-ledger 变更恒超时降级）；后端丢弃 daemon 回执（ok:false 原因与 CLI stderr 无人消费、无日志、无提示）；未触发同步时前端零反馈（auth-random-logout 从未同步过，用户无从知晓）。
成功标准：
- 后端 _FILES_REFRESH_SYNC_RPC_TIMEOUT_S 从 3s 放宽到 15s（覆盖实测 6~13.5s 同步耗时）
- 后端消费 sillyspec_sync_change 回执：ok:false/超时/远程错误/连接丢失记 warning 日志（含 reason 与 stderr_tail），成功与防抖跳过记 info
- GET files?sync=1 响应新增可选 sync_result 字段（triggered/ok/reason/stderr_tail）；默认纯读不带（null）
- 前端「刷新」按钮：sync_result 失败或未触发时展示同步未完成提示（含原因中文标注），文件树照常展示；成功与防抖跳过不提示
- 新增/更新后端与前端测试全绿，既有 test_files_refresh_sync.py 各路用例语义不回归
- 后端 openapi.json 与前端/daemon api-types.ts 依据 pnpm gen:types 重新生成并提交

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 后端 _FILES_REFRESH_SYNC_RPC_TIMEOUT_S 从 3s 放宽到 15s（覆盖实测 6~13.5s 同步耗时）
2. 后端消费 sillyspec_sync_change 回执：ok:false/超时/远程错误/连接丢失记 warning 日志（含 reason 与 stderr_tail），成功与防抖跳过记 info
3. GET files?sync=1 响应新增可选 sync_result 字段（triggered/ok/reason/stderr_tail）；默认纯读不带（null）
4. 前端「刷新」按钮：sync_result 失败或未触发时展示同步未完成提示（含原因中文标注），文件树照常展示；成功与防抖跳过不提示
5. 新增/更新后端与前端测试全绿，既有 test_files_refresh_sync.py 各路用例语义不回归
6. 后端 openapi.json 与前端/daemon api-types.ts 依据 pnpm gen:types 重新生成并提交

## 成功标准（可验证）

1. 后端 _FILES_REFRESH_SYNC_RPC_TIMEOUT_S 从 3s 放宽到 15s（覆盖实测 6~13.5s 同步耗时）
2. 后端消费 sillyspec_sync_change 回执：ok:false/超时/远程错误/连接丢失记 warning 日志（含 reason 与 stderr_tail），成功与防抖跳过记 info
3. GET files?sync=1 响应新增可选 sync_result 字段（triggered/ok/reason/stderr_tail）；默认纯读不带（null）
4. 前端「刷新」按钮：sync_result 失败或未触发时展示同步未完成提示（含原因中文标注），文件树照常展示；成功与防抖跳过不提示
5. 新增/更新后端与前端测试全绿，既有 test_files_refresh_sync.py 各路用例语义不回归
6. 后端 openapi.json 与前端/daemon api-types.ts 依据 pnpm gen:types 重新生成并提交
