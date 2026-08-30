---
author: qinyi
created_at: 2026-08-26 20:10:00
updated_at: 2026-08-26 20:15:00
plan_level: full
change: 2026-08-26-file-fullscreen-preview
---

# 实现计划（Plan）— 文件全屏预览

## Spike 前置验证

无（纯确定技术方案：antd Modal 尺寸切换/iframe sandbox/StreamingResponse 均有仓内先例，design §12 已注记两处实测点，属 task 内验证非 Spike）。

## Wave 1（并行，无依赖）
- task-01
- task-03

## Wave 2（依赖 Wave 1）
- task-02
- task-04

## Wave 3（依赖 Wave 2）
- task-05
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 raw 端点 | W1 | P0 | — | FR-04, D-001@v1, D-006@v1 | service.read_file_raw + 路径守卫提取 + router StreamingResponse + 5 用例 |
| task-02 | gen:types + 前端 lib | W2 | P0 | task-01 | FR-03, D-009@v1 | openapi.json/api-types.ts 再生成 + fetchChangeFileRaw（裸 fetch+Bearer） |
| task-03 | 渲染器层 fill + HtmlPreviewer | W1 | P0 | — | FR-02, FR-06, D-005@v1 | PreviewerProps.fill + 六渲染器高度适配 + registry html/svg/bmp/ico + 测试 |
| task-04 | FilePreviewModal 全屏态 | W2 | P0 | task-03 | FR-01, FR-02, D-003@v1, D-004@v1, D-008@v1 | fullscreen state + defaultFullscreen + 工具栏按钮 + 全屏样式 + fill={fullscreen} 透传渲染器 + 测试 |
| task-05 | 变更文件树接入 | W3 | P0 | task-02, task-04 | FR-03, D-001@v1, D-009@v1 | 非文本态改造（图片内联/卡片）+ 全屏预览按钮（fetch 恒走 raw）+ 测试 |
| task-06 | explorer 接入 | W3 | P0 | task-04 | FR-05, D-002@v1, D-007@v1 | ImagePreview 改 antd Image + 头部全屏按钮（含二进制分支）+ 测试 |

## 关键路径

task-01 → task-02 → task-05（后端端点 → 前端 lib → 变更树接入；与 task-03 → task-04 → task-05 等长，前端渲染器路径先行可并行消化）

## 全局验收标准
1. `cd backend && uv run pytest app/modules/change -q --no-cov -n auto` 全绿（local.yaml change 模块命令）
2. `cd frontend && pnpm test` 全绿（local.yaml frontend 模块命令）
3. 现有四类弹窗入口（会话附件/聊天文件卡/产出文件/文件中心）不传新 prop 时行为与现状一致（零回归，FR-01 GWT）
4. `pnpm gen:types` 产物（openapi.json + api-types.ts）已更新并纳入提交（CLAUDE.md 规则 21）
5. 集成冒烟（人工）：变更详情选 png → 内联可缩放 → 全屏预览撑满视口；explorer 选图片可缩放/全屏；弹窗内 antd Image 预览层不被全屏 Modal 遮盖（R-01 实测点）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-05 | raw 端点 5 用例 + 变更树图片内联用例 |
| D-002@v1 | task-06（边界） | explorer 改动不含 git-log 文件（git diff 对账） |
| D-003@v1 | task-04, task-05, task-06 | 弹窗全屏切换用例 + 两入口接入用例 |
| D-004@v1 | task-04 | 全屏态样式断言（100vw/100vh 类名） |
| D-005@v1 | task-03 | registry html 分发用例 + HtmlPreviewer sandbox 断言 |
| D-006@v1 | task-01 | 413/inline disposition/Content-Type 用例 |
| D-007@v1 | task-06 | explorer target 不携带 officeSource 断言 |
| D-008@v1 | task-04 | 不注册 keydown 拦截（无相关代码即证据） |
| D-009@v1 | task-02, task-05 | fetch 恒为 fetchChangeFileRaw 断言 |
