---
author: qinyi
created_at: 2026-08-23 23:15:00
plan_level: full
---
# 实现计划（Plan）— 前端暗色主题与三主题切换

## Spike 前置验证

不需要 Spike——技术方案确定性高：色阶取值全部来自 Tailwind v3 默认值（对照即可）、brand 阶 var 映射模式已在线上运行（slate 照抄）、darkAlgorithm 为 antd 6.4.4 官方导出（Grill C-12 实证）、zustand persist 水合语义已实证（Grill C-13/14）。原型已完成视觉验证。

## Wave 1（主题基建，并行无依赖）

- task-01
- task-02
- task-03

## Wave 2（接线与全站清理，依赖 Wave 1 基建）

- task-04
- task-05
- task-06
- task-07
- task-08
- task-09

## Wave 3（测试回归）

- task-10

## Wave 4（实测验收）

- task-11

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | themes.ts 新增 dark 主题取值 | W1 | P0 | — | FR-01, D-001@v1, D-004@v1 | ThemeName 扩 'dark'，翻转色阶+语义提亮档+label 暗夜 |
| task-02 | globals.css dark 变量块与硬编码修正 | W1 | P0 | — | FR-01, FR-04 | [data-theme=dark] 全套块；斑马纹混 --color-card；spinner --color-loading-track；--muted-fg 三套定义；清理遗留 .dark 死块 |
| task-03 | tailwind slate 阶变量化 | W1 | P0 | — | FR-04, D-005@v1 | var(--color-slate-*) 函数映射照 brand 模式；浅色逐值相等 |
| task-04 | store merge 跟随系统 | W2 | P0 | task-01 | FR-03, D-002@v1 | 无记录时 matchMedia 判定；SSR 安全沿用 persist 水合路径 |
| task-05 | layout 防闪烁脚本扩展 | W2 | P0 | task-01 | FR-02, FR-03, D-002@v1 | 合法值加 dark；无记录跟随 prefers-color-scheme；与 store 口径一致 |
| task-06 | antd-providers darkAlgorithm | W2 | P0 | task-01 | FR-01, D-006@v1 | dark→darkAlgorithm 三元；token 查表不动 |
| task-07 | theme-toggle 三选一下拉 | W2 | P0 | task-01 | FR-02, D-001@v1 | antd Dropdown 三项+当前高亮+aria |
| task-08 | 全站 bg-white→bg-card 清理 | W2 | P1 | task-01, task-02, task-03 | FR-01, FR-04 | 23 文件表面场景替换，品牌底保留（design §5.3 口径） |
| task-09 | ECharts 主题感知 | W2 | P1 | task-01 | FR-01 | aggregations.ts 颜色入参化 + 3 图表订阅 useThemeStore |
| task-10 | 测试扩展与存量回归 | W3 | P0 | task-01…task-09 | FR-01~FR-04 | themes.test.ts 完整性/翻转对称/浅色零回归断言；theme.test.ts 脏值口径；全量前端测试 |
| task-11 | 三主题浏览器实测 | W4 | P0 | task-10 | FR-01~FR-04 | 切换/记忆/防闪烁/系统跟随/图表文字/浅色回归目测，对照原型 |

## 关键路径

task-01/02/03（Wave 1 并行基建）→ task-08（全站清理，前置最重）→ task-10（测试回归）→ task-11（实测验收）。slate 变量化（task-03）是全站清理与验收的前置，与 task-01/02 同批并行启动。

## 全局验收标准

1. 前端测试全绿（`pnpm test`，含新增 dark 用例与既有 mock 回归）
2. 浅色两主题与上线前观感一致（slate 变量逐值相等断言 + 目测列表页/工作区/图表页）
3. dark 主题全站无残留纯白大色块；antd 表格/表单/弹窗/菜单/图表文字协调暗色（对照 prototype-frontend-dark-theme.html）
4. 三主题切换即时生效、刷新保持记忆、首帧不闪烁；系统暗色+无记录时首帧即 dark
5. （brownfield）已选 blue/ai-native 的用户行为不变；非法主题名兜底 ai-native 口径不变

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-07 | FR-02 三选一切换实测（task-11）；themes 注册表含 dark（task-10 断言） |
| D-002@v1 | task-04, task-05 | FR-03 无记录跟随系统首帧 dark 实测；merge/脚本口径单测 |
| D-003@v1 | task-01, task-02, task-03 | 换肤唯一机制仍是 data-theme+CSS 变量（code review 对照） |
| D-004@v1 | task-01, task-02 | 翻转对称断言（task-10）；暗色取值表逐值来自 Tailwind v3 |
| D-005@v1 | task-03 | slate 浅色逐值相等断言（task-10）；浅色目测零回归（task-11） |
| D-006@v1 | task-06 | dark 下 antd 组件灰阶适配实测（task-11） |
