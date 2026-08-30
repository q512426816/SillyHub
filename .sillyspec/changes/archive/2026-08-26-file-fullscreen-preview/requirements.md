---
author: qinyi
created_at: 2026-08-26 20:01:30
updated_at: 2026-08-26 20:01:30
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在变更详情、会话、文件中心、工作区文件浏览器查看文件内容的所有登录用户 |

## 功能需求

### FR-01: 统一预览弹窗全屏态
覆盖决策：D-003@v1, D-004@v1, D-008@v1

Given 用户打开了文件预览弹窗（任一现有入口）
When 点击工具栏「全屏」按钮
Then 弹窗撑满视口（width 100vw / height 100vh / 圆角清零），内容区占满可视高度，背景不可滚动

Given 弹窗处于全屏态
When 点击「退出全屏」按钮
Then 恢复普通态（`min(960px, 94vw)`，与现状一致），body 滚动锁解除

Given 弹窗以 `defaultFullscreen: true` 打开
Then 初始即全屏态；不传该 prop（缺省 false）时初始为普通态，现有四类入口行为零变化

Given 弹窗打开（任意态）
When 按下 Esc
Then 直接关闭弹窗（保持 antd 默认，不拦截分級退出）

### FR-02: 图片预览放大缩小
覆盖决策：D-003@v1

Given 弹窗内展示图片（普通态或全屏态）
When 点击图片
Then 进入 antd Image 内建预览层，可放大/缩小/旋转/重置，且预览层不被弹窗遮盖

Given 渲染器收到 `fill=true`（全屏态）
Then 图片/iframe/滚动容器高度撑满容器（替换 `max-h-[560px]`/`h-[70vh]`/`h-[74vh]`/`min-h-[420px]` 固定高）；`fill=false` 或缺省时类名与现状完全一致

### FR-03: 变更文件树接入统一预览
覆盖决策：D-001@v1, D-005@v1, D-009@v1

Given 变更文件树选中任意文件（文本或非文本）
When 点击工具栏「全屏预览」按钮
Then 以 `defaultFullscreen` 打开统一预览弹窗；fetch 恒走 `fetchChangeFileRaw`（不调用 content 端点，规避 1MB 截断）

Given 选中的是图片文件（png/jpg/jpeg/webp/gif/svg/bmp/ico）
Then 右侧预览区内联展示图片（antd Image，可点击放大），替代现状「暂不支持预览/编辑」占位

Given 选中的是非图片非文本文件（pdf/docx/xlsx 等）
Then 显示文件卡片（名称/大小）+「全屏预览」引导按钮

Given 图片加载失败（后端未部署/网络错误）
Then 内联区显示错误提示与重试/引导，不阻塞文件树其他功能

### FR-04: 后端变更文件二进制读取端点
覆盖决策：D-001@v1, D-006@v1

Given 持有 CHANGE_READ 权限的用户
When `GET /api/workspaces/{wid}/changes/{cid}/files/raw?path=<镜像内存在的图片>`
Then 200，Content-Type=mimetypes.guess_type 结果（未知回 application/octet-stream），Content-Disposition inline + RFC5987 filename*，body 为文件原始字节

When path 含 `../` 或绝对路径或符号链接逃出变更目录
Then 404（ChangeDocNotFound，与 files/content 同款守卫）

When 文件不存在
Then 404

When 文件 > 50MB
Then 413

When 无 CHANGE_READ 权限
Then 403

### FR-05: 工作区文件浏览器图片缩放与全屏
覆盖决策：D-002@v1（不含 git-log）, D-007@v1

Given explorer 选中图片文件
Then 预览区用 antd Image 展示（鉴权 objectURL 数据流不变），点击可放大/缩小/旋转

Given explorer 选中任意文件（含二进制分支的元信息卡）
When 点击头部「全屏预览」按钮
Then 以 `defaultFullscreen` 打开统一预览弹窗（fetch=fetchDownload，不携带 officeSource；mime 靠扩展名分发，svg/bmp/ico 与 png 一致可看）

### FR-06: HTML 原型全屏预览
覆盖决策：D-005@v1

Given 文件名为 .html/.htm（或 Content-Type text/html）
When 在统一弹窗中预览
Then 渲染为 iframe（sandbox="allow-scripts allow-popups"，不设 allow-same-origin），脚本可运行但隔离父页面 cookie/storage/DOM

## 非功能需求

- 兼容性：`defaultFullscreen`/`fill` 均缺省 false——现有入口与渲染器零回归；后端 `read_file` 仅内部重构（提取 helper），对外契约不变。
- 可回退：后端未部署新端点时，新前端入口 fetch 失败走错误态 UI，不影响其他功能；前端可独立回退（新按钮条件渲染无外部依赖）。
- 可测试：后端 raw 端点 5 个用例（200/404 穿越/404 不存在/413 超限/403 权限）；前端弹窗全屏切换、registry html+svg 分发、变更树非文本态、explorer antd Image 均有 vitest 用例。
- 平台兼容：后端读盘走 `asyncio.to_thread`；mimetypes 平台差异由前端 EXT_MAP 兜底（C-12）。
- 零新增 npm 依赖。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-03, FR-04 | 变更文件图片连后端 raw 端点一起做（用户确认） |
| D-002@v1 | FR-05（边界） | 覆盖范围不含 git-log（用户确认） |
| D-003@v1 | FR-01, FR-02, FR-03, FR-05 | 方案 A：统一弹窗升级（用户选定） |
| D-004@v1 | FR-01 | CSS 伪全屏，不用 Fullscreen API |
| D-005@v1 | FR-06 | 新增 HtmlPreviewer（iframe sandbox） |
| D-006@v1 | FR-04 | raw 50MB 上限 + inline disposition |
| D-007@v1 | FR-05 | explorer/变更文件不接 OnlyOffice |
| D-008@v1 | FR-01 | Esc 保持 antd 默认关窗 |
| D-009@v1 | FR-03 | 变更文件预览统一走 raw 端点（Grill C-04） |

无未覆盖决策，无剩余风险决策。
