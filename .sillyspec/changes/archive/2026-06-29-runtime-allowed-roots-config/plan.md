---
author: WhaleFall
created_at: 2026-06-29T10:25:55
change: 2026-06-29-runtime-allowed-roots-config
---

# Plan: runtimes allowed_roots 配置

**plan_level: full**

## 来源
`design.md`（§3-§11）+ `proposal.md` / `requirements.md` / `tasks.md`。

## 范围
backend（daemon 模块：runtime 模型 + API + 心跳响应）+ `sillyhub-daemon`（心跳同步 + CC permission 注入）+ frontend（`/runtimes` UI）。migration 加 `allowed_roots` 列。

## Wave 分组与任务

### Wave 1：backend 数据模型 + API + 心跳（基础）
- [ ] task-01: `daemon_runtimes` 加 `allowed_roots`（JSONB，默认 `["~/.sillyhub"]`）+ migration（存量回填）+ `DaemonRuntime` 模型/DTO + 单测
- [ ] task-02: `GET /api/admin/daemon/runtimes`（含 allowed_roots）+ `PUT /api/admin/daemon/runtimes/{id}/allowed-roots`（admin 权限 + 路径校验：绝对路径/`~` 展开/去重/上限）+ 测试（依赖 task-01）
- [ ] task-03: `POST /daemon/heartbeat` 响应 body 加 `allowed_roots`（依赖 task-01）

### Wave 2：daemon 心跳同步（依赖 task-03）
- [ ] task-04: `sillyhub-daemon` 心跳响应解析 `allowed_roots` → 同步本地 `config.allowed_roots`（合并 homedir 兜底，保证非空）+ 单测

### Wave 3：CC 写入拦截（依赖 task-04；独立复杂）
- [ ] task-05: 按 allowed_roots 生成 CC permission rules（`allow Write(白名单/**)` + `deny Write(**)` + 读自由）+ 注入 batch（`stream-json` adapter，permission-mode 非 bypass）+ interactive（`claude-sdk-driver` permission options）+ ⚠️ execute 先验证 CC permission 路径语法 + 单测

### Wave 4：frontend UI（依赖 task-02 API）
- [ ] task-06: `/runtimes` per-runtime allowed_roots 展示（Tag 列表）+ 多路径编辑（Drawer/Modal，admin）+ 调 PUT API

### Wave 5：端到端验证（依赖全部）
- [ ] task-07: list_dir 白名单放行 + CC 写白名单内/外 + CC 读自由 + 默认 `~/.sillyhub` + 兼容（未配置原样 / 旧 daemon 不读心跳 allowed_roots）

## 任务总表

| task | 优先级 | 依赖 | Wave |
|---|---|---|---|
| task-01 | P0 | — | 1 |
| task-02 | P0 | task-01 | 1 |
| task-03 | P0 | task-01 | 1 |
| task-04 | P0 | task-03 | 2 |
| task-05 | P0 | task-04 | 3 |
| task-06 | P1 | task-02 | 4 |
| task-07 | P0 | task-02, task-03, task-04, task-05, task-06 | 5 |

## 关键路径
task-01 → task-03 → task-04 → task-05 → task-07（CC 拦截链）。task-02 → task-06（frontend）可与 Wave 2/3 并行。

## 全局验收（含兼容性，design §9）
1. `/runtimes` 显示 + 编辑 allowed_roots 持久化（admin）。
2. 心跳 ~15s 同步 daemon 本地 config。
3. list_dir 白名单内放行、外拒绝。
4. CC 写白名单内成功、外 CC permission 拒绝（日志可见）。
5. CC 读自由（任意路径）。
6. 新 runtime 默认 `["~/.sillyhub"]`。
7. 兼容：未配置 allowed_roots 原样；旧 daemon 不读心跳响应的 allowed_roots（向后兼容）。

## 文件变更清单（design §3-§7）
- **backend**：`daemon/model.py`（DaemonRuntime + allowed_roots）、`daemon/router.py`（GET/PUT + 心跳响应）、`daemon/schema.py`（DTO）、`migrations/versions/`（add allowed_roots）、测试
- **sillyhub-daemon**：`src/config.ts`（同步）、`src/daemon.ts`（心跳响应解析）、`src/adapters/stream-json.ts` + `task-runner.ts`（CC permission 注入 batch）、`src/interactive/claude-sdk-driver.ts`（CC permission interactive）、测试
- **frontend**：`app/(dashboard)/runtimes/page.tsx`（UI）、`lib/daemon.ts`（client PUT）

## ⚠️ execute 确认项（design §11）
- CC permission 路径语法（`Write(//abs/path/**)`）+ 注入方式（CLI `--settings`/`--perms` vs SDK options vs 临时 settings.json）。
- `acceptEdits` + allow rules 白名单内写是否自动（不弹审批）。
- 心跳响应向后兼容（旧 daemon 不读 allowed_roots，新增字段不影响）。
