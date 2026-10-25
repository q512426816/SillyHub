---
author: qinyi
created_at: 2026-10-25T10:33:14.862Z
---
# 需求规格（Requirements）— 2026-10-25-reset-agent-log-adjudication

## 功能需求

### FR-01: SKILL.md 原「一次性运维动作」段替换为终局裁决记录

`.zcode/skills/deploy-to-server/SKILL.md` 中「一次性运维动作（agent 日志归属重构上线窗口，2026-09-13 部署裁决）——执行完可删本段」整段必须替换为终局裁决记录：包含重推窗口已关闭的生产库实证数据（09-14 周起 1059 行日志 100% 新版 daemon 正确归属、897 个新代 tool_report 会话、change_session_links 最新至 10-25；旧残留仅 6 行日志 + 1 旧会话 + 2 旧链接）、「永不执行 --apply」结论与残留面处置口径；禁止保留任何「待执行/确认后加 --apply」的可行动指引。

#### 场景：主路径

- Given：读者（未来部署会话）打开 deploy-to-server SKILL.md 的部署验证节
- When：阅读原一次性运维段位置
- Then：读到的是终局裁决记录（窗口关闭实证 + 永不执行结论），不再出现可执行的 apply 指引或「执行完可删本段」字样

### FR-02: 常见坑清单对应条目口径同步

「常见坑」清单中「清库迁移已改 no-op（2026-09-13 部署裁决）」条目必须同步收敛口径：不再以「见『更新部署 §4』的一次性运维动作段」为待办指引，改为指向终局裁决记录（永不执行）；脚本本体与 no-op 迁移设计的事实描述保留。

#### 场景：主路径

- Given：读者在常见坑清单读到清库迁移条目
- When：按条目指引跳转
- Then：到达的是终局裁决事实，而非「待跑一次」的运维待办

### FR-03: 纯文档改动边界

本变更必须仅触及 `.zcode/skills/deploy-to-server/SKILL.md` 与本变更目录自身产物；禁止改动 backend/frontend/sillyhub-daemon/deploy 下任何文件（`backend/scripts/reset_agent_log_attribution.py` 本体不动——保留脚本与 docstring 作为历史设计事实，裁决只封存其执行指引）。

#### 场景：主路径

- Given：flow done 收口对账
- When：核对变更文件面
- Then：文件清单只含 SKILL.md 与变更目录产物，src/test 零触及

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯运维知识文档改写，无可执行行为面；验收靠规范与人工核对（AGENTS.md 测试按层适用条款）
FR-02: 不适用：同 FR-01，文档口径同步
FR-03: 不适用：文件面边界由 flow done 收口核对（冻结 patch 对账）保证，无需独立测试
