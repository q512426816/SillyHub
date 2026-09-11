
## ql-20260911-027-13b6 | 2026-09-11 16:48:56 | pi 会话 AskUser 弹窗缺失修复——vendored ask-user 扩展补发起端
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/vendor/pi-extensions/ask-user/index.ts（新增自研扩展（AskUserQuestion 工具））
- | sillyhub-daemon/vendor/pi-extensions/README.md（补 ask-user 自研件行+双降级开关）
- | sillyhub-daemon/src/interactive/pi-rpc-driver.ts（共用路径解析+ask-user 装载）
- | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（beforeEach off 同款+5 新例）
- | .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引补 ql-20260911-027-13b6）
- sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（软归属·同模块测试，未声明）
需求：pi 会话 AskUser 弹窗缺失修复——vendored ask-user 扩展补发起端
根因：2026-09-09-askuser-pi-cursor 只做了 pi 弹窗链路的接收半（extension_ui_request→平台弹窗桥接），但 pi 本体无任何模型可调的提问工具、daemon 只挂 subagent 扩展，发起端缺失——pi 会话模型只能文字罗列问题（会话 d4c29d95 实证 session_dialog_requests 零行）
方案：新增自研扩展 vendor/pi-extensions/ask-user/index.ts 注册 AskUserQuestion 工具（有选项 ctx.ui.select、无选项 ctx.ui.input，不传 timeout 永久等待，降级路径明确文本）；pi-rpc-driver 抽共用 resolveVendoredExtensionPath + piVendoredAskUserExtensionPath（SILLYHUB_PI_ASK_USER_EXTENSION 可 off）+ spawn 第二个 --extension；工具名对齐 claude 内置名使双端 tool-kind 分类器零改动
结果：pi-rpc-driver 78 passed（+5 新例）；tsc 0；本机真实 pi CLI 装载冒烟通过（对照实验验证方法有效）；待提交后 bundle 部署服务器 + 本机 daemon 自更新 + 平台真机验证
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/src/interactive/pi-rpc-driver.ts, sillyhub-daemon/vendor/pi-extensions/README.md, sillyhub-daemon/vendor/pi-extensions/ask-user/
审计：🔍 软归属：1 个窗口内未声明同模块测试文件已补入文件行（若属并行会话改动请手工剔除）：sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（+78/-0）

## ql-20260911-028-8736 | 2026-09-11 19:01:43 | 代报需要延迟兜底——活体 mission c4731a06/worker 4ca98b77 实证 claude_code 分身（mcp=true 自报路径）未调…
状态：已完成
关联变更：2026-09-10-review-dispatch-platform-fixes
文件：
- sillyhub-daemon/src/daemon.ts（缓存+延迟兜底）
- sillyhub-daemon/src/hub-client.ts（getMissionStatus opts）
- sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts（新增 6 用例）
- .sillyspec/docs/SillyHub/modules/daemon.md（代报链条目）
需求：代报需要延迟兜底——活体 mission c4731a06/worker 4ca98b77 实证 claude_code 分身（mcp=true 自报路径）未调 worker_done 工具致 artifacts 恒空。
根因：立即代报只覆盖 mcp=false（claude 自报无兜底）；pi 空白 result（override 晚到）无补报机会；叠加 workspace b97f8231 default_agent=NULL 使派发白跑 claude（已补 pi）。
方案：一切 mission_worker 成功轮 +90s 探测 getMissionStatus（session-scoped opts.sessionId）——本 run artifacts 仍空且 mission 活跃才用 result/会话级最后全文兜底代报（防双写）；文本缓存双写源（onTurnMessage 完整 text 事件 + result），FIFO 500 上限。
结果：daemon 18 用例（新增 6：兜底触发/已自报跳过/不活跃跳过/pi 立即后不二次/空白+晚到全文/探测失败与缺失）+回归 111 全绿，tsc 过；4ca98b77 已手工回填（artifact 8da04f9c 全文 11928 字节）；uuid 配对疑点裁决非 bug（_revoke_committed_partials 按 segment_id 单段配对，by-design）。
