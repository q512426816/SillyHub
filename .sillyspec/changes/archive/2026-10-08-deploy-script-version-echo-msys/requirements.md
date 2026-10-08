---
author: flow-machine-draft
created_at: 2026-10-08T03:29:51.019Z
---
# 需求规格（Requirements）— 2026-10-08-deploy-script-version-echo-msys

## 功能需求

### FR-01: 回显命令经 sh -c 传路径（MSYS 安全），grep 模式兼容 "version": 与 "version":两种形态

- 必须：回显经 docker run --entrypoint sh … -c 间接传路径（裸 /app/... 参数在 Git Bash/MSYS 下会被改写为 Windows 路径导致 cat/grep 找不到文件）；grep 模式 `"version"[: ]*"[^"]*"` 兼容冒号后有/无空格。

#### 场景：主路径

- Given 焙入的 /app/sillyspec-package.json
- When Git Bash 打包跑到版本回显行
- Then 输出「镜像内 sillyspec 版本: 3.32.1」而非「查询失败」

### FR-02: 本地实跑 docker run 回显 3.32.1 成功

- 必须：回显经 docker run --entrypoint sh … -c 间接传路径（裸 /app/... 参数在 Git Bash/MSYS 下会被改写为 Windows 路径导致 cat/grep 找不到文件）；grep 模式 `"version"[: ]*"[^"]*"` 兼容冒号后有/无空格。

#### 场景：主路径

- Given 焙入的 /app/sillyspec-package.json
- When Git Bash 打包跑到版本回显行
- Then 输出「镜像内 sillyspec 版本: 3.32.1」而非「查询失败」

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：构建脚本一行传参形态修复，验收以 bash -n + 本地 docker run 实跑回显为准
FR-02: 不适用：同上，本地实跑回显 3.32.1 即验收
