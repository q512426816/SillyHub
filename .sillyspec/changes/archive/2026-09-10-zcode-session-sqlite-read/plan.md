---
author: qinyi
created_at: 2026-09-10 11:45:52
plan_level: full
---

# 实现计划（Plan）— zcode 会话读取恒走本地 SQLite

## Spike 前置验证

无需 Spike：全部技术前提已在 brainstorm/Design Grill 对本机真实库实证（tool part
单条形态、hidden 判据、time 对象、part 类型全集、node:sqlite 版本带、WAL 只读）。

## Wave 1（并行，无依赖）
- task-01
- task-04

## Wave 2（依赖 task-01）
- task-02

## Wave 3（依赖 task-02）
- task-03

## Wave 4（依赖 task-02/03/04）
- task-05

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | sess id 提取纯函数 + fixture SQLite 测试库构造器 | W1 | P0 | — | FR-01 | `extractZcodeSessId(path)`（主/子代理两文件名形态）+ 按真实 schema 造库的测试 helper（可注入库路径） |
| task-04 | backend content 端点 zcode 分支 | W1 | P0 | — | FR-02, D-001@v1, D-002@v1, D-007@v1 | messages RPC 合成九字段伪 jsonl（不截断）+ 非 parsed/抛错回落 read_file（含 256KB 原语义）；mock RPC 用例 |
| task-02 | read-zcode-sqlite 读取器 | W2 | P0 | task-01 | FR-01, D-003@v1, D-004@v1, D-006@v1 | node:sqlite 惰性只读开库 + message×part 归一化（实证映射表）+ hidden 过滤 + beforeSeq 窗口 + 未知类型/坏行容错；fixture 全场景用例 |
| task-03 | host-fs-handler 分派接线 | W3 | P0 | task-02 | FR-03, FR-04, D-005@v1, D-001@v1 | 守卫后、registry 前 zcode format 先库后文件；读取器库路径经模块级工厂注入（默认 ~/.zcode/cli/db/db.sqlite，测试覆写），不动 RPC 协议；分派四态用例（库成功不碰文件/库败文件在=成功/双败=not_found/claude 不走新分支） |
| task-05 | @types/node bump + 回归 + 真实库冒烟 | W4 | P0 | task-02, task-03, task-04 | FR-04, D-006@v1, 非功能 | devDep @types/node ≥22.13；daemon agent-log + backend platform_sync 相关套件回归；本机真实库抽会话冒烟（含死会话/隐藏过滤/工具两段） |

## 关键路径
task-01 → task-02 → task-03 → task-05（读取器链最长；task-04 与之并行）

## 全局验收标准
1. 新增测试全绿：read-zcode-sqlite（fixture 全场景）、zcode-sqlite-dispatch（四态）、
   backend test_agent_log_content（zcode 合成/回落/claude 不走新分支）
2. 既有零回归：daemon agent-log 既有套件（parse-zcode-model-io 等）、backend
   platform_sync 既有用例、typecheck/build 绿
3. 真实库冒烟（integration-critical 证据）：本机 db.sqlite 抽 ≥3 会话（含文件已清理
   的死会话）经读取器归一化——量化基准：抽 1 个文件仍在的会话，读取器与文件 parser
   输出总段数一致（±10%）；hidden 消息零泄漏（user_input 段全部来自非隐藏消息）；
   tool use/result 两段配对（completed/error 各抽验）；beforeSeq 翻页正常
4. claude/codex 读取路径行为不变（分派用例断言不经 SQLite 分支）
5. 不改上报协议/前端/sillyspec CLI/liveness（diff 范围=文件清单 7 项；fixture 构造器
   作为 read-zcode-sqlite.test.ts 内联 helper，不新增清单外文件）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-03 | 验收 3（恒库）+ 分派四态用例 |
| D-002@v1 | task-04 | content 合成分支不截断用例 |
| D-003@v1 | task-02 | hidden 三判据过滤 fixture 用例 + 冒烟"零泄漏" |
| D-004@v1 | task-02 | tool 单 part 两段（含 running/pending）fixture 用例 |
| D-005@v1 | task-03 | 守卫先于分派（用例：越界 path 仍被守卫拦） |
| D-006@v1 | task-02, task-05 | 惰性导入失败降级用例 + @types bump |
| D-007@v1 | task-04 | 九字段封闭序列化快照用例 + 回落捕获范围 |
| FR-01 | task-01, task-02 | 读取器全场景用例 + 真实库冒烟 |
| FR-02 | task-04 | content zcode 分支用例 |
| FR-03 | task-03 | 分派四态用例 |
| FR-04 | task-03, task-05 | claude 分支断言 + 回归 + diff 范围检查 |
