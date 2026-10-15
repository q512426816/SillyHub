---
author: flow-machine-draft
created_at: 2026-10-15T16:20:00.000Z
---
# 需求规格（Requirements）— 2026-10-16-proto-pipeline-discoverability

## 功能需求

### FR-01: CONVENTIONS.md 原型管线指针节（必须）

multi-agent-platform 项目图 scan 面 `CONVENTIONS.md` 必须新增「前端原型管线（prototype-as-code）」节，内容必须含：①管线入口 `pnpm prototype:build`（frontend/scripts/prototype-build.mjs）；②源目录 `frontend/src/components/prototype/`（TSX 视图 import 生产 primer 组件）；③产物目录 `frontend/prototype-dist/`（自包含离线 HTML，禁手改）；④分型规约与工作流铁律指针 `.sillyspec/docs/SillyHub/scan/PROTOTYPE.md`、样式基准 `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`（相对路径指引——本图 agent 查本图 scan 即可发现）；⑤声明：frontend 触达的 UI 变更定稿原型必须走此管线，archive 中历史手绘原型是 2026-09-27 管线收编前旧物、不构成惯例依据。

#### 场景：主路径——agent 查本图 scan

Given agent 在 multi-agent-platform 项目图下做 UI 变更，按规则读本图 scan CONVENTIONS.md
When 读到「前端原型管线」节
Then 拿到管线入口与规约指针，不再误判「项目无 React 原型管线」。

### FR-02: local.yaml ui_prototype 登记（必须）

`.sillyspec/local.yaml` 顶层必须新增 `ui_prototype` 段：`form: real-code`，并带注释注明管线位置（pnpm prototype:build / frontend/src/components/prototype/ / SillyHub 图 PROTOTYPE.md）。登记后 sillyspec（2026-10-15-ui-proto-form-config 契约）的 UI 须知从「未登记强提醒」转为「真码契约」态。

#### 场景：主路径——跨仓联动

Given 本登记落盘且 sillyspec 新契约在位
When buildUiGuidanceLines(specBase) 渲染
Then 注入「🔒 真码契约（real-code）」行（readUiPrototypeForm 实测 registered real-code）。

### FR-03: 验证与零回归（必须）

必须以 sillyspec 侧 `readUiPrototypeForm` 实测解析本仓 local.yaml 登记为 registered/form=real-code；纯文档+配置变更必须零代码面（不触 frontend/src、backend/）；平台仓既有门（docs/lint 如适用）必须通过。

#### 场景：主路径

Given 改动落盘
When readUiPrototypeForm 实测 + 平台仓门
Then registered=true、form=real-code；零代码 diff。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯文档指针节（验收靠规范与人工；Grep 锚点随变更留档）
FR-02: 不适用：配置登记（readUiPrototypeForm 跨仓实测作为验证，属 FR-03 场景）
FR-03: 不适用：纯文档+配置零代码面（readUiPrototypeForm 实测留痕于收口摘要与提交消息）
