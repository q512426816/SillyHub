---
id: task-15
title: e2e-manual-acceptance-deploy-docs
title_zh: E2E 手工验收（验收 1-8）+ Docker 部署验证 + 文档同步
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-14]
blocks: []
requirement_ids: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10]
decision_ids: [D-6, D-7, D-9]
allowed_paths:
  - .sillyspec/changes/2026-08-20-session-multimodal-attachments/module-impact.md
  - .sillyspec/docs/SillyHub/modules/daemon.md
  - .sillyspec/docs/SillyHub/modules/agent.md
  - .sillyspec/docs/SillyHub/modules/models.md
  - .sillyspec/docs/SillyHub/modules/llm_provider.md
  - .sillyspec/docs/SillyHub/modules/frontend_app.md
goal: >
  按 requirements.md 验收 1-8 逐项手工 E2E 验收（含 FR-10 降级），完成 Docker 部署验证与模块文档回填，收尾整个 change。
implementation:
  - 验收 1（FR-2）多模态模型会话发截图 → 模型回复能描述图中内容
  - 验收 2（FR-4）发 .log 文件 → agent 用 Read 工具读到并引用内容；核对会话 cwd/attachments/ 落盘与 prompt 路径清单
  - 验收 3（FR-5）发 PDF → 模型直接总结 PDF 内容（DocumentBlock 链路）
  - 验收 4（FR-6）重进会话 → 图片缩略图/文件 chip 回显正常（标记行 + /content 拉取）
  - 验收 5（FR-1/3/8）超限（超 5MB 图、超 5 张、超 20MB 文件）→ 前端预检与 backend 4xx 均明确报错，无脏数据入库
  - 验收 6（FR-7，D-6）codex 会话无附件入口；构造携 attachment_ids 的 inject 请求 → 422 HTTP_422_SESSION_ATTACHMENTS_UNSUPPORTED
  - 验收 7（FR-9，D-7）纯附件无文字消息 → 正常发送并获回复
  - 验收 8（FR-10，D-9）multimodal=false 或 auto 未命中别名的 provider 发图 → turn 不失败、图片落盘 + prompt 注明降级、前端显示降级提示条
  - Docker 部署验证在 deploy/ 下执行 docker compose build --no-cache frontend 再 up；验证镜像内前端构建 chunk 含附件特征字符串（如 session-attachments 接口路径），排除旧缓存层（教训见 docs/sillyspec/finished/sillyspec-worktree-execute-pitfalls.md §7 镜像没真更新是最常见隐性失败；backend 若动过依赖按该节绕过方案容器内 import 验证）
  - 文档同步回填 module-impact.md 更新结果表，daemon/agent/models/llm_provider/frontend_app 五行 pending 置 done（storage 与 _module-map 保持 skipped）；五张模块卡补本 change 引入的附件条目，与实际实现一致
  - 本卡是 full change 收尾，QUICKLOG 不适用（quick 流专用）；每项验收在 module-impact.md 回填处留一句证据
acceptance:
  - requirements.md 验收 1-8 逐项通过并留痕（每项一句证据）
  - docker compose build --no-cache frontend 构建成功，部署后前端 chunk 含附件功能特征（非旧缓存产物）；部署环境复跑验收 1 与 8 抽查
  - module-impact.md 五个 pending 行回填完成，五张模块卡内容与实现一致
verify:
  - cd backend && uv run pytest -q（收尾全量回归）
  - cd frontend && pnpm test
  - cd sillyhub-daemon && pnpm test
  - cd deploy && docker compose build --no-cache frontend
  - sillyspec progress show --change 2026-08-20-session-multimodal-attachments（仓库根目录执行，规则 22）
constraints:
  - 手工验收只读不改代码；发现缺陷回对应 task（05/06/09/10/12/13）修复后重验，不在本卡打补丁
  - 模块卡更新只追加本 change 引入的事实，不重写既有历史内容
related_tests: []
---
