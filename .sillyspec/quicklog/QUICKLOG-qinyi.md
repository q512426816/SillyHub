
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
