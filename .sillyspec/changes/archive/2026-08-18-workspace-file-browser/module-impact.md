---
author: qinyi
created_at: 2026-08-18 12:55:00
---

# 模块影响分析

## 变更：2026-08-18-workspace-file-browser

> plan 阶段首版（实现前基于 design.md 文件变更清单声明范围）；verify/archive 阶段按实际 diff 复核更新。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| sillyhub-daemon | 接口变更 | sillyhub-daemon/src/file-rpc.ts | 新增 explorerListDir/explorerReadFile/explorerSearch 三函数 + EXPLORER 常量（realpath+allowed_roots 双校验、10MB 截断、encoding 参数、搜索噪声排除）；旧「不读文件内容」非目标守卫测试随契约更新改写 |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/daemon.ts | 注册 explorer_list_dir/explorer_read_file/explorer_search 三 handler（roots 现取 _effectiveAllowedRoots，不沿用裸 list_dir 空 roots 豁免） |
| sillyhub-daemon | 测试新增 | sillyhub-daemon/tests/file-rpc-explorer.test.ts | realpath 逃逸/截断/二进制嗅探/base64/搜索上限/噪声排除矩阵 |
| backend | 模块新增 | backend/app/modules/explorer/（__init__/schema/service/router） | workspace 作用域四端点 tree/file/download/search，WORKSPACE_READ 鉴权，绑定解析复用 MemberBindingResolver，PureWin/PurePosix containment 预检，显式超时 30/30/60/60s，中文错误映射 |
| backend | 接口变更 | backend/app/main.py | 挂载 explorer router |
| workspace（member_runtimes） | 无改动复用 | backend/app/modules/workspace/member_runtimes/resolver.py | 复用 resolve_member_binding_or_none，零修改 |
| backend | 测试新增 | backend/tests/modules/explorer/test_explorer.py | containment 拒绝矩阵/绑定解析/错误映射/download 头 |
| backend | 契约产物 | backend/openapi.json | gen:types 重新生成（4 端点 schema） |
| frontend | 依赖变更 | frontend/package.json + pnpm-lock.yaml | 新增 react-syntax-highlighter + @types |
| frontend | 契约产物 | frontend/src/lib/api-types.ts | gen:types 生成 Explorer 三响应类型 |
| frontend | 逻辑新增 | frontend/src/lib/explorer.ts | 四端点 fetch 封装（fetchTree/fetchFile/fetchDownload/fetchSearch） |
| frontend | 组件新增 | frontend/src/components/explorer/file-explorer.tsx | antd Tree 懒加载 + 文件名搜索 + 祖先链直达 |
| frontend | 组件新增 | frontend/src/components/explorer/file-preview.tsx | 代码高亮/Markdown/图片 blob/元信息卡 + 下载 |
| frontend | 页面新增 | frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx | 左树右预览装配 + 三降级态 |
| frontend | 逻辑变更 | frontend/src/components/workspace-tabs.tsx | TABS 加「文件」标签（explorer） |
| frontend | 测试新增 | components/explorer/__tests__/ + workspaces/[id]/__tests__/explorer-page.test.tsx | 组件与页面级测试 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| docs/multi-agent-platform/modules/backend.md | 待 verify 阶段评估（新增 explorer 模块条目） | ⏳ pending |
| docs/multi-agent-platform/modules/frontend.md | 待 verify 阶段评估（explorer 页面/组件条目） | ⏳ pending |
| docs/multi-agent-platform/modules/sillyhub-daemon.md | 待 verify 阶段评估（file-rpc explorer 扩展条目） | ⏳ pending |
