# UI 视觉证据（Visual Evidence）

> 本变更为纯协议/后端变更，无界面视觉变化——前端仅 `frontend/src/lib/api-types.ts` 类型生成物被动更新（gen:types 产物，无手写组件/样式/布局改动）。

## 说明

- **触达前端文件**：仅 `frontend/src/lib/api-types.ts`（OpenAPI 类型生成物，SessionRuntimeRequest/SessionReadyRequest 新增可选 `cwd` 字段类型）。
- **视觉变化**：无。会话面板工作目录徽标（session-config-bar）为数据驱动的既有组件，cwd 落库后从「不渲染」变「渲染」属数据有无差异，非视觉设计变化（design 已声明原型跳过，分级依据：纯后端逻辑变更）。
- **409「无关联工作目录」错误提示场景**：随 `DaemonSessionNoCwd` 退役整体消失，无需截图对照。

## 发版顺序说明（R-02）

**先 daemon、后 backend**——新 daemon 对带 cwd 的 payload 三级链第一级命中零影响；backend 后发时存量空 cwd 会话立即获得完整兜底。顺序颠倒时（backend 先发）空 cwd 会话明确 failed（不静默），无数据损坏。
