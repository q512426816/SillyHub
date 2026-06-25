---
author: qinyi
created_at: 2026-06-25 10:06:00
change: 2026-06-25-frontend-error-handling
project: frontend
---

# Requirements — 前端错误处理规范化

## 角色

| 角色 | 说明 |
|---|---|
| 最终用户 | 在浏览器操作（删除/创建/更新）或浏览页面时，期望错误以友好中文提示，不看到英文 code 或 500 白屏 |
| 前端开发者 | 用统一 `errMessage`/`useNotify` 处理错误，遵循展示策略规范，不再各处自造 |

## 功能需求

### FR-01: errMessage 纯函数取中文文案
覆盖决策：D-001@v1, D-002@v1, D-006@v1

```
Given 一个 ApiError(code="HTTP_409_DAEMON_RUNTIME_IN_USE", message="该 daemon 仍被 1 个 workspace 绑定…")
When 调用 errMessage(err)
Then 返回 "该 daemon 仍被 1 个 workspace 绑定…"（后端中文 message 原样）
```
```
Given 一个 ApiError(code="network_error", message="Failed to fetch")  # 浏览器英文
When 调用 errMessage(err)
Then 返回 "网络连接失败，请检查网络后重试"（中文兜底）
```
```
Given 一个普通 Error（非 ApiError，无业务 message）
When 调用 errMessage(err)  /  errMessage(err, "加载失败")
Then 返回 "操作失败"（默认 fallback） / 返回 "加载失败"（传入 fallback）
```
```
Given 任意错误对象
When 调用 errMessage(err)
Then 返回值绝不包含 err.code（英文 HTTP_xxx）作为展示内容
```

### FR-02: useNotify hook 统一通知入口
覆盖决策：D-005@v1, D-007@v1

```
Given 组件渲染在 <AntApp> 内（dashboard 全局已包裹）
When 调用 const notify = useNotify(); notify.error(err)
Then 调用 antd messageApi.error(errMessage(err))，弹出中文 toast
```
```
Given 操作成功
When 调用 notify.success("运行时已移除")
Then 弹出 antd 成功 toast
```

### FR-03: daemon runtime 删除落地
覆盖决策：D-003@v1, D-007@v1

```
Given 用户在 runtimes 页点某 runtime 的「移除」
When 触发删除
Then 弹出 antd Modal.confirm（destructive 主题，中文警告），而非原生 window.confirm
```
```
Given 确认删除后后端返回 409（被 workspace 绑定）
When ApiError 抛出
Then notify.error(err) 弹中文 toast「该 daemon 仍被 N 个 workspace 绑定…」；列表不变（runtime 仍在）
```
```
Given 确认删除后后端返回 204
When 成功
Then notify.success("运行时已移除")；列表移除该卡片
```

### FR-04: D 模式 16 处收敛
覆盖决策：D-004@v2, D-007@v1

```
Given 16 处 `${err.code}: ${err.message}` 拼接（精确清单见 design §6）
When 替换为 errMessage(err) / notify.error(err)
Then 用户不再看到英文 code；原展示方式（toast/inline）保持；grep 残留 = 0
```

### FR-05: 合并 3 处重复 errMessage util
覆盖决策：D-002@v1

```
Given kanban.ts / ppm problem-list / problem-changes 各有局部 errMessage
When 改为 import 全局 lib/errors.ts 的 errMessage
Then 行为等价（全局版多 network 兜底，属增强）；局部函数删除
```

### FR-06: 展示策略规范文档化
覆盖决策：D-007@v1

```
Given 本次确立的展示策略（操作 toast / 加载 inline / 表单 inline / 确认 Modal）
When 写入模块文档（lib-errors.md 注意事项区）
Then 后续开发者有明确约定可循
```

## 非功能需求

- **NFR-01 兼容性**：Windows + macOS 主流浏览器；不破坏 `apiFetch`/`ApiError` 契约与现有测试。
- **NFR-02 国际化**：所有用户可见错误文案中文（后端 message 已中文 + network 兜底中文）。
- **NFR-03 性能**：`errMessage` 纯函数无 IO/副作用；`useNotify` 复用 antd 上下文，无额外开销。
- **NFR-04 渐进式**：未接入新 util 的页面行为零变化。
- **NFR-05 可测**：`errMessage` 各分支单测覆盖；`pnpm test` 全绿。

## 决策覆盖关系

| 决策 | 覆盖 FR |
|---|---|
| D-001@v1 errMessage 取文案规则 | FR-01 |
| D-002@v1 fallback 签名/默认值 | FR-01, FR-05 |
| D-003@v1 成功 toast 仅 daemon | FR-03 |
| D-004@v2（supersedes D-004@v1） D 模式精确清单 16 处 | FR-04 |
| D-005@v1 方案 B util+useNotify | FR-01, FR-02 |
| D-006@v1 不做映射表 | FR-01 (约束) |
| D-007@v1 按场景展示 | FR-02, FR-03, FR-04, FR-06 |
