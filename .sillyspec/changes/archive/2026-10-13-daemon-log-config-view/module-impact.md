# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成；execute Wave 收尾按实际 diff 回填）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> 影响类型与 review 标记为 execute 主代理按实际 git diff 判定（真实 > 声明）。
> 注：backend 测试文件实际路径为 backend/tests/modules/daemon/test_daemon_machine_diag.py
> （执行期 D-008 裁决，plan 首版骨架按 design 原路径列示）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| app-pages | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 逻辑变更（新增 diagTarget state + 诊断弹窗条件渲染 + MachineCard onOpenDiagnostic 接线） | 否（可选 prop 接线，页面既有行为零改动，82 项既有测试全绿） |
| daemon | `sillyhub-daemon/src/daemon.ts` | 新增（_registerDiagRpcHandler 私有方法 + 注册调用 + import；无既有方法签名改动） | 否（12/12 新单测 + 全量 typecheck 0 错） |
| lib-api | `frontend/src/lib/api-types.ts` | 数据结构变更（gen:types 产物：新增 DaemonLogTailResponse/DaemonConfigResponse 两 schema 类型） | 否（自动生成，openapi 541 paths 含新端点） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——均已逐一判定为**模块索引粒度问题**（新文件不在 paths 枚举内，非游离文件；后续可跑 `sillyspec modules rebuild` 刷新索引）：

- `sillyhub-daemon/src/diag-rpc.ts` → 归 daemon 模块（新增：诊断 RPC 纯逻辑，task-01）
- `sillyhub-daemon/tests/diag-rpc.test.ts` → 归 daemon 模块（新增单测，12 用例）
- `backend/app/modules/daemon/schema.py` → 归 backend 模块（新增两个响应 DTO）
- `backend/app/modules/daemon/router/machines.py` → 归 backend 模块（新增两个 GET 端点 + _send_diag_rpc 共享转发；既有端点零改动）
- `backend/app/modules/daemon/router/__init__.py` → 归 backend 模块（_ENDPOINT_ORDER 追加两项）
- `backend/tests/modules/daemon/test_daemon_machine_diag.py` → 归 backend 模块（新增端点测试，11 用例）
- `backend/openapi.json` → 归 backend 模块（生成产物：+2 paths +2 schemas）
- `frontend/src/lib/daemon/machines.ts` → 归 lib-api/前端 daemon client 域（新增两个 fetch 函数 + api-types 类型别名）
- `frontend/src/components/daemon/daemon-diagnostic-dialog.tsx` → 归前端 daemon 组件域（新增组件）
- `frontend/src/components/daemon/machine-card.tsx` → 归前端 daemon 组件域（可选 prop + 两个按钮，既有 props 面零改动）
- `frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx` → 归前端 daemon 组件域（新增组件测试，8 用例）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/app-pages.md` | runtimes 页新增诊断弹窗接线（一行级） | done（changelog sidecar 登记） |
| `modules/daemon.md` | daemon 侧新增 diag RPC（handler 注册 + diag-rpc.ts） | done（changelog sidecar 登记） |
| `modules/lib-api.md` | api-types 产物新增两 schema 类型 | done（changelog sidecar 登记） |
| `_module-map.yaml` | 根 map 三模块 main_symbols 各追加一条（sillyhub-daemon readLogTail/getMaskedConfig、backend machine diag 端点、frontend DaemonDiagnosticDialog）；新文件物理路径已被各模块 paths glob（backend/** 等）覆盖，细粒度索引刷新留给 scan 周期 | done（archive step2 手动同步，2026-10-13） |
