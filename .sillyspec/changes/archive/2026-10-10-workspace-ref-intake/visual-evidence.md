# UI 视觉验证证据（visual-evidence）

> verify 移交项补录（2026-10-12）：部署至本机 Docker（frontend 镜像重建）后浏览器实测。

## 实测环境

- 部署：multi-agent-platform-frontend-1 容器（127.0.0.1:3000，镜像 2026-10-12 重建，commit 4cc3c2a1a 含交付代码 dc6a8111f）
- 页面：/sessions?session=f231ca18-0a5b-403d-a594-edf105827f1c（暗夜主题）
- 方式：浏览器自动化（DOM 事件派发 + 状态断言 + 截图视觉评审）

## 验证清单

| 场景 | 结果 | 证据 |
|---|---|---|
| 文件树右键目录节点 → 菜单「添加目录到会话输入框 .sillyspec」 | ✅ 弹出且 preventDefault | DOM 断言：menu in DOM=true；菜单项含节点名提示 |
| 点击菜单项 → 输入框光标处插入标签 | ✅ | textarea.value 出现【.sillyspec】 |
| 预览纯文本文件带行号 | ✅ | .editorconfig 预览 data-ws-ref-line 1-5 在场 |
| 选中 1-3 行右键 → 菜单「添加选中内容到会话输入框（.editorconfig:1-3）」 | ✅ 行号正确 | 菜单项文本断言；选区文本 "root = true…" |
| 点击 → 代码块标签插入，与目录标签共存 | ✅ | textarea.value = 【.editorconfig:1-3】【.sillyspec】 |
| 标签左上类型角标 + 背景块对齐 | ✅ | 截图视觉评审：两标签各有圆形角标（FileText/Folder），文字完整落色块无错位 |

截图：会话页输入区特写存档于 ZCode artifacts（2026-10-12 会话 call_09ac7e6…png）。

## 结论

UI 视觉与交互符合原型（prototype-workspace-ref-intake.html B 角标样式），verify 探针 12 ⚠️ 闭环。

## 过程备注（部署链路）

- 3000 端口为 Docker 生产容器（非 dev server）——首次实测不弹菜单的根因是旧镜像（47h 前构建）无新代码；`docker compose up --build --force-recreate -d frontend` 重建后全链路通过。
- 容器内 grep 确认新代码在场（.next/server/chunks/7644.js 含「添加目录到会话输入框」）。
- 发送置换链路未在容器实测（daemon 离线态），由 261 用例（含组装位端到端断言）覆盖。
