# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/daemon/router/session_crud.py` 
- `backend/app/modules/daemon/router/session_queue.py` 
- `backend/app/modules/daemon/schema.py` 
- `backend/app/modules/daemon/session/service/queue.py` 
- `backend/app/modules/daemon/tests/test_session_queue.py` 
- `backend/app/modules/daemon/tests/test_session_queue_actions.py` 
- `sillyhub-daemon/src/interactive/providers.ts` 
- `sillyhub-daemon/scripts/gen-provider-caps.mjs` 
- `sillyhub-daemon/tests/interactive/provider-registry.test.ts` 
- `frontend/src/lib/provider-caps.ts` 
- `frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` 
- `backend/app/modules/agent/provider_caps.py` 
- `backend/app/modules/agent/tests/test_provider_caps_alignment.py` 
- `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` 
- `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` 
- `frontend/src/lib/daemon/sessions.ts` 
- `frontend/src/components/daemon/session-panel/session-panel-page.tsx` 
- `frontend/src/components/daemon/session-panel/session-panel-dialog.tsx` 
- `frontend/src/components/daemon/message-queue-bar.tsx` 
- `frontend/src/lib/api-types.ts` 
- `frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx` 
- `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` 

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需 rebuild——19 个未匹配文件经逐条判定均属既有模块（backend/sillyhub-daemon/frontend）语义范围，仅 CLI 前缀表未覆盖细粒度路径，非索引过期 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
