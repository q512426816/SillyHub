---
author: flow-machine-draft
created_at: 2026-10-21T01:23:19.299Z
---
# 需求规格（Requirements）— 2026-10-21-precommit-sandbox-entries

## 功能需求

### FR-01: pre-commit 三条 entry（ruff-format/ruff-check/assertion-surfaces）去 bash -c 包装改直连命令，uv 加 --cache-dir 重定向进仓内 .tmp/（gitignored），pre-push 两条既有语义不动

- pre-commit 阶段三条 entry（ruff-format/ruff-check/assertion-surfaces）**必须**移除 `bash -c` 包装改为直连命令（`uv run --cache-dir .tmp/uv-cache …`，cwd=仓根），使 hook 链不再在 python 子树内嵌套 msys；uv 缓存**必须**重定向进仓内 gitignored 的 `.tmp/uv-cache`（沙箱 Low 子树禁写 profile AppData）；pre-push 阶段两条（ci-fast-gate/docs-gate）**必须**保持既有 `bash -c` 语义不动（推送发生用户终端 Medium 树，agent 会话不推送；提示文案原样保留）。

#### 场景：主路径

- Given agent 沙箱把 python.exe 子树 IL 降为 Low（探针实证：嵌套 token 无 CodexSandboxUsers、profile 写被驱动白名单拦、msys 对象目录 Medium 标签打不开）
- When 官方 pre-commit runner 在该子树执行三条 entry
- Then 全程不产生 python→msys 嵌套（无 `bash -c`），uv 全部落盘在仓内 .tmp/，hook 正常出结果而非 0xC0000022 崩溃

### FR-02: 官方 runner 在 agent python 子树内实跑通过：PRE_COMMIT_HOME 指向仓内时 pre_commit run assertion-surfaces 与 ruff-check 均正常出结果（不再 msys 崩）

- 在 agent python 子树内以 `PRE_COMMIT_HOME=<仓内 gitignored 路径>` 实跑官方 runner：`pre_commit run assertion-surfaces`（always_run）**必须** exit 0 通过；`pre_commit run ruff-check --files backend/app/main.py` **必须**正常给出 ruff 结果（PASS 或 ruff 自身报错，而非 msys 崩溃）；两者回执写入交付提交消息留痕。

#### 场景：主路径

- When venv python 以仓内 PRE_COMMIT_HOME 运行 `python -m pre_commit run assertion-surfaces` 与 `pre_commit run ruff-check --files backend/app/main.py`
- Then 两命令正常退出（前者 exit 0；后者 ruff 结果语义），stderr 无 NtCreateDirectoryObject/0xC0000022

### FR-03: hook 配置合法（pre-commit validate-config），scripts/ 断言面闸门语义不变

- 改动后 `backend/.pre-commit-config.yaml` **必须**通过 `pre-commit validate-config`；`scripts/check-assertion-surfaces.py` 本体零改动、其既有单测 `scripts/test_check_assertion_surfaces.py` **必须**保持全绿（闸门语义不变，仅入口适配）。

#### 场景：主路径

- When 跑 validate-config 与该单测
- Then 前者零错误、后者全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯配置与注释改动，无可断言的单测面（规则 3 记录）；验收即 FR-02 的官方 runner 实跑与 FR-03 的 validate-config。
FR-02: 不适用：运行时实跑验证（回执写入交付提交消息 + flow done 实测），非测试文件面。
FR-03: backend/tests/test_check_assertion_surfaces.py「断言面闸门既有单测（14 用例）」
