---
id: task-10
title: "git_identity schema 校验"
title_zh: "git_identity 用户名/邮箱 pattern 校验 + gitconfig 写入纵深防御"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-11]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/git_identity/schema.py
  - backend/app/modules/git_identity/tests/test_schema_validation.py
  - backend/app/modules/worktree/exec_env.py
  - backend/app/modules/worktree/tests/test_exec_env_gitconfig.py
provides: {}
expects_from: {}
goal: >
  git_identity 的 git_username/git_email 加单行 pattern 校验阻断 gitconfig 换行注入，exec_env.write_gitconfig 写入前防御性拒绝换行作纵深。
implementation:
  - 先写失败测试。git_identity 侧新建 tests/test_schema_validation.py——git_username 含换行、含 [ 或 ]、含其它控制字符的 payload POST 创建 identity 期望 422；git_email 含换行 / 非 email 格式期望 422；合法值（如 testuser、a.b@example.com、含空格与点的用户名）回归通过
  - schema.py GitIdentityCreate（:14-15）git_username 改 Field(pattern=r"^[\w.\- ]{1,64}$")——单行、无方括号、无控制字符，长度上限 64
  - git_email 改 Field(pattern=标准 email 正则) 或 EmailStr（二选一，EmailStr 需 email-validator 依赖已存在则优先；核实 backend uv 依赖后定）
  - worktree 侧新建 tests/test_exec_env_gitconfig.py——write_gitconfig 传入含 \n 的 username/email 时抛 ValueError（或拒绝写入该段并记日志，按实现选定后断言一种），不含换行的正常值写入内容回归
  - exec_env.py write_gitconfig（:92-103）在拼 lines 前对 git_username / git_email 做防御性校验——任一值含 \n 或 \r 即抛 ValueError（schema 层已拦，这里是纵深：绕过 schema 的内部调用 / 旧数据不落成恶意 gitconfig）
  - 核对 worktree 既有 exec_env 相关测试是否有直调 write_gitconfig 的用例需同步（grep write_gitconfig in worktree/tests）
acceptance:
  - git_username 含换行、回车、方括号或控制字符的创建请求返回 422
  - git_email 含换行或非法 email 格式返回 422
  - write_gitconfig 对含换行输入抛 ValueError，不产生含注入行的 gitconfig 文件
  - 合法 username/email 走完整链路（创建 identity → write_gitconfig 落盘内容）回归不变
verify:
  - cd backend && uv run pytest app/modules/git_identity -q --no-cov
  - cd backend && uv run pytest app/modules/worktree -q --no-cov
constraints:
  - pattern 校验只加在 GitIdentityCreate 入口 DTO，GitIdentityRead（出参）不动——旧存量数据读取不因历史值不合规而 500
  - exec_env 防御层语义选 ValueError（fail-fast 而非静默跳过），注入尝试要可观测；注释写明与 schema 层的关系（纵深非重复）
  - git_username 允许空格与点（中文用户名如需支持则 pattern 加 unicode 类，按现有测试 fixtures 的 testuser 口径先 ASCII，若既有用例有中文名则放宽）
  - 不动 askpass 写入与 credential 处理（token 走独立链路，无 gitconfig 注入面）
related_tests:
  - path: backend/app/modules/git_identity/tests/test_router.py
    reason: 既有创建用例（:22 git_username=testuser）合法值不受 pattern 影响，预期回归通过；若 fixtures 使用了含特殊字符用户名需同步调整
  - path: backend/app/modules/worktree/tests/test_router.py
    reason: 若有直调 ExecEnvBuilder.write_gitconfig 或触发 gitconfig 落盘的 lease 用例，防御性 ValueError 加入后需确认传入值均合法
---
