---
author: qinyi
created_at: 2026-10-15 16:34:00
plan_level: full
execution_mode: main  # dispatch=子代理派发；本变更任务量小单会话直写最省（R7/R8 对撞实证），缺省 main
---

# 实现计划（Plan）— 2026-10-15-server-logs-panel

## Wave 1（无依赖）
- task-01

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2）
- task-03

## Wave 4（依赖 Wave 3）
- task-04

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端日志落盘 | W1 | P0 | — | FR-01 / D-001@v1, D-006@v1, D-008@v1 | FileWriter processor（同渲染实例+per-write 句柄+轮转）+ log_dir 派生 + 测试 |
| task-02 | 后端日志端点 | W2 | P0 | task-01 | FR-02, FR-03 / D-003@v1, D-004@v1, D-008@v1 | log_reader + 两端点 + 白名单/三态测试 + gen:types 契约同步（openapi.json/api-types.ts） |
| task-03 | 前端数据层与日志组件 | W3 | P0 | task-02 | FR-02, FR-04 / D-002@v1, D-005@v1 | health.ts 数据层（类型引用生成物）+ ServerLogPanel 组件 + 组件测试 |
| task-04 | 页面改造与聚焦回归 | W4 | P0 | task-03 | FR-04 / D-007@v1 | 删统计卡+集成本组件+断言更新+全用例扫描回归 |

## 关键路径
task-01 → task-02 → task-03 → task-04（线性 4 跳——响应类型经 gen:types 生成物单一路径流转，无并行分支）

## 全局硬约束（绑定所有 task；主体源自 design.md，另三条为仓库级约束）
- stderr 输出链路零变化（FileWriter 插 JSONRenderer 前只写文件不改 event_dict；既有测试不回归——task-04 verify 含 test_health 回归命令）
- MUST NOT 日志脱敏/过滤/搜索/zip 打包/新权限枚举/容器编排改动（proposal 不在范围内）
- 下载文件名白名单校验（防目录遍历）
- 前端接口类型走生成物（规则 21 完整义务）：两新端点使 openapi.json 必须随 task-02 同提交导出 + `pnpm gen:types` 再生成 frontend/src/lib/api-types.ts（ServerLogsResponse 入生成物）；禁止手写 api-types.ts〔.claude/CLAUDE.md 规则 21〕
- 品牌色一律 brand-* 语义阶；颜色不硬编码 hex；阴影走主题 token〔仓库级，.claude/CLAUDE.md 规则 20〕
- UI 和文档默认中文；代码兼容 Windows/Linux/macOS（句柄/rename 语义按跨平台写）〔仓库级，.claude/CLAUDE.md 规则 12/13〕
- 日志文件写入目录启动期自动创建、失败降级 stderr-only（进程安全）

## 全局验收标准
1. 聚焦单元测试通过：backend 落盘/轮转测试 + 端点测试（含防遍历/三态）、前端组件测试 + page.test.tsx 更新后
2. tsc --noEmit 与 eslint 零错（frontend）；ruff/mypy 零错（backend 改动文件）
3. （brownfield）stderr 日志行为零变化（test_health 与既有日志相关用例不回归）；未配置 log_dir 时开箱派生可用
4. 页面行为：无业务统计卡；日志卡 5s 刷新/行数切换/展开原始行/下载历史文件全部可用

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | 轮转测试（小 max_bytes 注入）+ 空态渲染 |
| D-002@v1 | task-02, task-03, task-04 | 解析降级用例 + 组件渲染/切换用例 |
| D-003@v1 | task-02, task-03 | 白名单防遍历用例 + 下载 Blob 用例 |
| D-004@v1 | task-02 | 三态鉴权用例（401/403/200） |
| D-005@v1 | task-03, task-04 | 安全提示文案在场断言 |
| D-006@v1 | task-01 | 双写逐字一致用例（中文 event） |
| D-007@v1 | task-04 | 统计卡删除断言 + 日志卡满宽在场 |
| D-008@v1 | task-01, task-02 | lines 白名单回退用例 + 常量单点引用 |
