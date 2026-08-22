# Runtime Evidence 冒烟日志（smoke-e2e.mjs）

时间：2026-08-22T07:42:26.014Z；链路：Chrome headless → dev server http://localhost:3000（main 新代码）→ backend http://127.0.0.1:8001（真实数据）

## 断言
✅ S1 发送按钮=antd primary — title=发送 class=ant-btn-primary
✅ S1 TurnStatusBadge=antd Badge — 页内 .ant-badge 数=1（含选中会话时间线状态徽标）
✅ S1 初始主题=ai-native — data-theme=ai-native
✅ S1 主题切换生效 — data-theme=blue
✅ S1 双主题品牌色翻转 — --brand-600 #7c3aed → #2563eb
✅ S2 弹窗「新建会话」=antd Button
✅ S2 弹窗「结束会话」=antd Button
✅ S2 提供方徽标=antd Tag — .ant-tag 数=1
✅ S2 弹窗发送按钮=antd primary
✅ S3 workspace 会话区发送按钮=antd primary

## 步骤
[2026-08-22T07:41:59.632Z] STEP0-dev-server-ready http://localhost:3000（复用已运行）
[2026-08-22T07:42:01.364Z] STEP1-sessions-page-loaded http://localhost:3000/sessions
[2026-08-22T07:42:06.042Z] STEP1-sessions-done 截图 01-sessions-ainative.png/02-sessions-blue.png
[2026-08-22T07:42:09.811Z] STEP2-machine-expanded 
[2026-08-22T07:42:13.645Z] STEP2-runtime-dialog-opened 
[2026-08-22T07:42:19.475Z] STEP2-dialog-done 截图 03-runtimes-dialog-ainative.png/04-runtimes-dialog-blue.png
[2026-08-22T07:42:22.762Z] STEP3-workspace-sessions data-theme=ai-native 截图 05-workspace-sessions.png
[2026-08-22T07:42:26.014Z] STEP4-change-detail data-theme=ai-native 截图 06-change-detail.png 会话卡=true
[2026-08-22T07:42:26.014Z] SUMMARY 断言 10 条，失败 0；console错误 1；4xx/5xx 0

## console 错误
Warning: [antd: Modal] `destroyOnClose` is deprecated. Please use `destroyOnHidden` instead.

## HTTP ≥400
（零）
