# 视觉证据对照（visual-evidence）

> 2026-10-15-zcode-engine-appserver execute 期落盘。

## UI 触达面认定

本变更前端口仅一处：`frontend/src/lib/daemon/runtimes.ts` 的 SESSION_SUPPORTED_PROVIDERS 数组加 `"zcode"` + PROVIDER_META 加一条展示元数据（label/icon/color）。无布局/结构/流程/样式变化——**引擎下拉枚举追加**，可见性由 runtime 探测门控（无 zcode runtime 注册的机器上该选项不出现，page-helpers 的 rt.provider 过滤）。

## 对照结论（渲染面无新视觉态，以行为测试为证）

| 验证面 | 证据 | 结论 |
|---|---|---|
| 白名单枚举正确性 | `frontend/src/lib/daemon/__tests__/runtimes.test.ts`（4 用例：五引擎有序含 zcode、ENGINE_OPTIONS 派生 label、META 三字段、防裸 key 回退） | PASS |
| caps 门控查表（前端十六键钉板） | `frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` zcode 全对象 toEqual（task-05 连带同步） | PASS |
| 现有消费方零回归 | sessions-portal / session-list-panel / pre-session-picker 三测试文件 mock 该模块，既有用例 32 全绿 | PASS |
| 群聊白名单零变化 | create-group-wizard.tsx:93/100 独立硬编码（不含 zcode） | PASS |

## 截图未产出的理由

无新页面/新布局/新交互态——纯枚举追加（同 dsh 变更原型跳过判例，用户 Step5 已确认）。引擎下拉在实际渲染中的出现条件（机器探测到 zcode runtime）依赖 daemon 注册数据，属集成态；其正确性由 runtime 白名单单测 + backend 注册链路覆盖，不产生新的视觉断言面。如后续需要端到端 UI 截图（真实 runtime 注册后下拉出现 ZCode），归 verify/验收手工冒烟补录。
