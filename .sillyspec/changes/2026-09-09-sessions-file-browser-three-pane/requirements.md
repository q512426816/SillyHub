---
author: qinyi
created_at: 2026-09-09T00:55:30
---

# 需求文档（Requirements）— 会话页三分屏：会话 ⇄ 工作区文件浏览器

## FR-01 左栏二模切换

- 会话模式（默认）：现状 SessionListPanel；头部「共 N 个」右侧新增「📁」切换按钮（aria-label「查看工作区文件」，data-testid=sessions-left-files-toggle）。
- 文件模式：左栏整体替换为 PortalFileTreePanel——头部「← 返回会话」按钮（data-testid=sessions-files-back）+「工作区文件」标题 + FileExplorer（自带搜索/懒加载/错误态/刷新）。
- 切换不改变右侧会话窗口状态（中栏四分支：群/会话/预会话/空态均不动）。

## FR-02 两入口支持与上下文解析

- scope 入口（workspace/change/quicklog）：切换目标恒为 scope.workspaceId。
- 全局 /sessions：目标 = selectedWorkspaceId 快照 state——各选中点写入（列表 onSelect s.workspace_id；群 onSelectGroup/handleGroupCreated group.workspace_id；会话/群深链 getAgentSession 返回体 workspace_id；enterPreSession preContext.workspaceId；清选中路径置 null）。
- 无上下文（null）：按钮 disabled，title「请先选择一个会话，再查看其所属工作区的文件」。
- files 模式中选中变化不退出文件模式：树工作区 = 进模式时快照（filesModeWorkspaceId），返回会话清快照。

## FR-03 右侧文件内容列

- 点文件 → setFilePreview({workspaceId: 树快照工作区, path})；同文件重复点幂等。
- 列结构：把手 + 列壳（「✕」关闭 data-testid=sessions-file-preview-close + FilePreview 只读预览含下载/全屏）。
- 未点文件不渲染整列（含把手）；「✕」关列收起；切回会话列表预览列保留。
- 预览生命周期独立于左栏模式与后续选中变化；重进文件模式树按新工作区时旧预览仍按其 {workspaceId, path} 取数。

## FR-04 三栏拖拽调宽

- 左栏：PanelResizer + usePanelWidth（storageKey=SESSIONS_LEFT_PANEL_WIDTH_LS_KEY，默认 320，min 240，max 560，aria「调整会话列表宽度」）；会话模式同样生效。
- 右列：storageKey=SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY，默认 480，min 320，max 860，aria「调整文件预览宽度」。
- 中栏 flex-1 min-w-0 自动伸缩；刷新页面宽度记忆（localStorage）。

## FR-05 代码结构与质量

- 新组件文件收纳文件模式两壳（portal 不膨胀）；SessionListPanel 仅加可选 headerExtra?: ReactNode（其它消费点零变化）。
- 测试：portal 层 mock explorer 两组件测交互状态机（切换/置灰/深链翻转/保留/关闭）；壳组件层 mock lib/explorer 测接线与回调；既有 sessions-portal 39 用例与 explorer 页用例零回归。
- tsc --noEmit 无新增错误；eslint 改动文件 0 error 0 warning。

## 边界与异常

- 未绑定成员/daemon 离线：FileExplorer/FilePreview 自带 404/502 降级卡（工作区页同款），不新增处理。
- 非工作区会话（workspace_id=null）：置灰（同无选中）。
- 移动端：不加文件浏览入口（非目标，走工作区 explorer 页）。
