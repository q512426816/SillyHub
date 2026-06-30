---
author: WhaleFall
created_at: 2026-06-29T10:20:20
change: 2026-06-29-runtime-allowed-roots-config
---

# Tasks: runtimes allowed_roots 配置

> 待 plan 阶段按 Wave 展开。方向与文件清单见 `design.md` §3-§7。

## 预估任务方向（plan 细化）
- [ ] backend：`daemon_runtimes` 加 `allowed_roots` 列 + migration（默认 `["~/.sillyhub"]`，存量回填）+ 模型/DTO
- [ ] backend：`GET /api/admin/daemon/runtimes` 含 allowed_roots + `PUT /api/admin/daemon/runtimes/{id}/allowed-roots`（admin 权限+路径校验）+ 测试
- [ ] backend：`POST /daemon/heartbeat` 响应带 allowed_roots
- [ ] sillyhub-daemon：心跳响应解析 allowed_roots → 同步本地 config（合并 homedir）+ 单测
- [ ] sillyhub-daemon：CC 写入拦截——按 allowed_roots 生成 CC permission rules（allow Write 白名单 + deny Write(**) + 读自由）+ 注入 batch（stream-json adapter）/ interactive（claude-sdk-driver）+ ⚠️ execute 先验证 CC permission 路径语法
- [ ] frontend：`/runtimes` per-runtime allowed_roots 展示 + 多路径编辑 UI（admin）+ 调 PUT API
- [ ] 验证：list_dir 放行 + CC 写白名单内/外 + CC 读自由 + 默认 ~/.sillyhub + 兼容
