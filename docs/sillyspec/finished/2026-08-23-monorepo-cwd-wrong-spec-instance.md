---
author: qinyi
created_at: 2026-08-23T20:23:44
---

# monorepo 下 cwd 在子目录跑 sillyspec 会静默绑错 .sillyspec 实例（仅警告不阻断）

- 日期：2026-08-23
- 状态：**活跃坑**（工具未修；绕过方案明确——坚持主仓根目录跑，即 CLAUDE.md 规则 22）
- 发现来源：QUICKLOG ql-20260823-011-d9bf 会话误启动现场

## 现象

agent 会话的 shell cwd 停留在 `SillyHub/backend/`（跑完一次后端脚本未回根目录），此时执行 `sillyspec run quick`：

- CLI 打印"检测到祖先链有 2 个 .sillyspec 实例(monorepo 多实例)，当前使用： /Users/qinyi/SillyHub/backend/.sillyspec"的**警告后继续执行**；
- quick 会话（QUICKLOG 条目、changeDir、进度库）全部落到 `backend/.sillyspec` 实例，与主仓 `.sillyspec` 的 QUICKLOG/进度库分裂；
- 发现后需 `sillyspec run quick --reset --change <sessionId>` 重置，回根目录重启会话重来。

## 根因

多实例检测只提示不阻断；默认取"离 cwd 最近的祖先实例"，而 monorepo 子项目实例（backend/frontend 各有自己的 .sillyspec）与主仓实例语义不同——用户/agent 几乎永远想要主仓实例。

## 影响

- QUICKLOG/quick 会话/进度落错实例，主仓 QUICKLOG 出现条目空洞；
- 若不及时发现，同一天的 quick 编号在两个实例各自递增，事后对账困难。

## 建议工具修复方向

- 检测到祖先链多实例且"当前实例 ≠ git 顶层仓库实例"时，**默认拒绝执行**，要求显式 `--spec-dir` 或在对应项目根目录执行；
- 或至少把警告升级为需要确认的交互（CI/agent 环境 fail-fast）。

## 关联

- CLAUDE.md 规则 22（本坑的制度化绕过方案）
