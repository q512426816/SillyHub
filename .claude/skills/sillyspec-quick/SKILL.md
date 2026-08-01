---
name: sillyspec:quick
description: 用于明确、低风险、范围很小的直接任务。适合用户说"直接改、快速修、顺手调整、改个文案、修个小 bug、更新一个文件、不要完整流程"。跳过 brainstorm/plan，但仍按 sillyspec quick 流程执行。
---

## 何时使用

- 明确、低风险、范围小的直接修改：改文案、修小 bug、更新单个文件
- 用户说"直接改、快速修、顺手调整、不要完整流程"
- brainstorm 判定 `scale=small` 的变更：带 design.md 进 quick（`sillyspec run quick --linked-changes <变更名>`），design 当背景
- 跳过 brainstorm/plan，但仍走 quick 的 3 步流程（理解任务 → 实现 → 自检提交）

## 多变更说明（quick 特殊，务必注意）

quick 阶段的 `--change` 语义是「关联变更」**且会触发步骤重置**，**不要用 `--change` 来指定关联变更**。多活跃变更时改用：

- `--linked-changes none`：不关联，仅记 QUICKLOG（CLI 启动时写入）
- `--linked-changes a,b`：显式关联到变更 a、b
- `--non-interactive`：CI/脚本环境，默认不关联（避免交互 prompt 崩溃）

首次 `sillyspec run quick` 选定的关联会持久化到 `.runtime/quick-sessions/<quick-session-id>/guard.json`（每个 quick 会话独立，多会话并发不互覆盖），后续 `--done` 自动复用，**不会重复弹交互 prompt**。

## 步骤生命周期（所有阶段通用）

> `sillyspec quick` 是 `sillyspec run quick` 的顶层别名，两者等价。

```bash
sillyspec run quick                            # 输出当前步骤 prompt（首次会记录 baseline）
sillyspec run quick --done --output "摘要"     # 完成当前步骤
sillyspec run quick --status                   # 查看阶段进度
sillyspec run quick --skip                     # 跳过可选步骤
sillyspec run quick --reset                    # 重置阶段（从头开始）
sillyspec run quick --reopen --from-step N     # 重新打开已完成阶段修订（N=序号或名称）
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--interactive` | 强制交互（即便 stdin 非 TTY） |
| `--skip-approval` | 跳过审批/校验门控（需明确意图） |
| `--json` | 输出 JSON（程序化读取） |

## quick 特有参数

| 参数 | 说明 |
|---|---|
| `--linked-changes none\|a,b` | **显式关联变更（取代 `--change`，推荐）**。none=不关联，a,b=关联列表 |
| `--files a.js,b.js` | 显式声明本次允许修改的文件（边界保护） |
| `--allow-new` | 允许新增文件（默认禁止，防意外创建） |
| `--force-baseline` | 允许覆盖 baseline 受保护文件 / 压制 `.sillyspec/` 危险判定（危险，慎用） |
| `--confirm` | ⚠️ 仅打印变更概览，**不解锁 blocked**（blocked 仍 exit 1）。真正解锁用 `--force-baseline`/`--allow-new` |

## 审计与并发变更（`--done` 边界审计）

`--done` 收尾时对比 step1 baseline 与当前 `git status`，拦「危险文件 / 新增文件 / 覆盖 baseline」。要点：

- **并发其他会话的 `.sillyspec/changes/<非关联变更>/` 不再被本 quick 拦截**。quick 自己没有 `changes/` 目录，该路径下非关联内容视为并发会话的工作，整体放行（确定性审计无法区分「并发工作」与「本 quick 偷建变更」，后者这类意图软判定留给 sillyhub）。
- **关联变更的文件仍走审计**：reverse-sync 改自己关联变更的 `design.md` 会被拦，需 `--force-baseline` 显式确认。
- **baseline 折叠目录前缀匹配**：step1 启动时整片 `changes/` 未跟踪会被 git 折叠成 `?? .sillyspec/changes/`（带尾斜杠 token）；审计时若该目录下文件被并发会话跟踪而展开成文件级路径，按尾斜杠 token 前缀放行其下所有文件，不误判。
- **`--confirm` ≠ 解锁**：它只打印概览。blocked 时真正解锁的是 `--force-baseline`（压制 `.sillyspec/` 危险判定 + baseline 覆盖）/`--allow-new`（放行新增），两者在 step1 或 `--done` 传都生效。

## 典型用法

```bash
# 单变更项目，直接开始
sillyspec run quick

# 多变更项目，显式不关联
sillyspec run quick --linked-changes none

# 多变更项目，关联到指定变更
sillyspec run quick --linked-changes 2026-07-03-add-login

# CI/脚本（非交互，避免 prompt 崩溃）
sillyspec run quick --non-interactive
sillyspec run quick --done --linked-changes none --output "修复手机号校验"

# 限定修改文件范围
sillyspec run quick --files src/phone.ts,src/phone.test.ts
```

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- quick 直接在主工作区改代码（不创建 worktree），范围必须小且明确
- 完成后立即 `--done`，不跳过
- QUICKLOG 记录的**骨架由 CLI 接管**：启动时 CLI 自动分配 ql-ID 并在 `.sillyspec/quicklog/QUICKLOG-<user>.md` 写「进行中」条目（含关联变更 tasks.md），`--done` 时 CLI 自动翻「已完成」+ 勾选 task + 回填文件路径。ql-ID 分配/状态/task 你无需手写，只需用注入的 `<quicklog-id>` 在模块文档变更索引引用
- **QUICKLOG 正文精修（`--done` 后必做，不可跳过）**：CLI 落盘的是简版骨架（标题可能是 `(quick 任务)`、文件是单行逗号无括注），**不合格**。`--done` 成功后必须立即编辑本次 `<quicklog-id>` 条目，手动精修成丰富格式：① 标题改真实需求摘要（禁 `(quick 任务)`）；② 文件改多行 bullet、每行带关键改动括注（禁 `（见实际改动）` 或无括注纯路径）；③ 正文 `需求：`/`根因：`/`方案：`/`结果：` 四段逐项充实（禁只留一段「结果：」）。参照同文件早期丰富条目。一条 quick = 一条独立 ql，不追加到旧条目
- **最后一步 `--done --output` 必须按结构化结果模板给全四字段**（逐项一句话）：`需求：… 根因：… 方案：… 结果：…`。这是 QUICKLOG「结果：」归档的唯一来源；CLI 校验缺字段会拒绝 `--done`（exit 1），补全后重跑即可。前两个 step 的 `--output` 是中间摘要，不用此模板
- **禁止**在没有运行 CLI 的情况下自行决定流程

## 用户指令
$ARGUMENTS
