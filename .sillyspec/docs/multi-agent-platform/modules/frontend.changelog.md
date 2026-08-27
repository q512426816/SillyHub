# frontend 变更索引

> 自动生成。正文历史已迁出，详见 frontend.md。
> author: qinyi
> created_at: 2026-08-26 10:20:00

- ql-20260826-007-8666 | 创建工作区对话框加 slug 输入框：默认值从工作区名称实时派生（lib/workspaces 新增 `slugifyWorkspaceName`，逐行为对齐后端 schema.slugify：非字母数字折叠连字符/去首尾/小写/兜底 workspace/截断 100），手动编辑过即脱离跟随；提交体非空才带 slug（空=省略走后端派生）；label 标注「创建后不可修改」。移动端创建不加新 UI（沿 D-006 非移动端功能改造惯例，后端派生兜底）。新单测 workspace-scan-dialog.test.tsx 5 用例（派生/纯中文兜底/脱离跟随/省略/手输优先）。
- ql-20260826-008-55ce | 团队任务块展开内容被裁剪且无滚动条修复：TeamTaskBlock 根节点补 shrink-0——父层（session-panel 两渲染点会话团队任务列表 flex-col + max-h-220px + overflow-y-auto）内 flex 子项默认 shrink:1 被压扁，配合块自身 overflow-hidden 裁掉底部分身行、父层永不溢出（滚动条不出现）；shrink-0 保持自然高度让限高滚动真正生效。补回归用例 1 个（jsdom 无真实布局，断言根节点 shrink-0 class），team-block 27 + session-panel-team 12 测试全绿，tsc 0。
- ql-20260827-005-8bca | 登录页删除登录名输入框常显前缀提示（Form.Item extra，连注释一并删；登录失败错误卡内同语义指路提示保留——仅失败场景出现）+ 变更文件弹窗 MD 宽内容横向滚动条补链：ql-20260818-008 只给 FilePreview 三分支加了 min-w-0，宽度约束链在上层 grid item（默认 min-width:auto）与内层 flex 容器处仍断——MD 宽表格把 grid 1fr 轨道撑大、被上层 overflow-hidden 裁掉且无滚动条；change-file-tree.tsx 右列两层包装补 min-w-0 后列宽锁住，overflow-auto 正常出左右滚动条。验证：change-files-card 2 用例过 + 两改动文件 eslint 0 error（1 既有 warning 在未触及代码处）。
