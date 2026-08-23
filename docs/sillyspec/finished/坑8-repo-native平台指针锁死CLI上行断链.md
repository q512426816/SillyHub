# 坑8：repo-native 工作区平台指针锁死 CLI 内置 sync——本地变更断链不上平台

> 发现于 2026-08-23（变更 2026-08-23-repo-native-spec-backfill）。
> 状态：已修复（sillyspec 仓提交 2c35ab2 发版 3.27.3 + SillyHub backend scan 门禁）。

## 现象

repo-native 工作区里本地 agent 会话（ZCode 等）产出的变更（四件套/进度）不出现在平台变更中心；服务器 spec 镜像停留于上次会话结束时间。项目根存在 `.sillyspec-platform.json`（specRoot 指向 `~/.sillyhub/daemon/specs/<ws>`）与 `.sillyspec-platform-managed` 接管声明。

## 根因（三边叠加）

1. backend `build_scan_bundle` 对**所有策略**无条件注入 `--spec-root` 等平台参数（scan/stage 门禁不对称，stage 仅 platform-managed 注入）→ scan 后 CLI 在项目根写下指针+接管声明。
2. CLI 检测到指针即平台模式：`triggerSync` 显式跳过内置 sync（"平台模式走自己的回传链路"）；指针恢复链每条 run 命令重入平台模式；接管声明还 fail-closed（指针被删后本地裸跑 exit 1）。
3. daemon 回灌仅三触发点（tar 会话结束/手动按钮/pull 前回灌）——repo-native junction 早退永不 pull、本地会话无 lease 无结束钩子。

三边叠加 = 本地产物无任何上行通道。且 **`sillyspec platform disconnect` 会连 local.yaml 的 platform 凭据一起删**，不能用它清理（手动 `rm` 指针+声明、保留 local.yaml 即可）。

## 修复（2026-08-23）

- **backend**（task-01）：`build_scan_bundle` 三分支——repo-native 本地模板（零平台参数、无 init 防"本地 init 残留清理删 local.yaml"坑），platform-managed/repo-mirrored 逐字节不变。
- **CLI 3.27.3**（task-02/03/04）：`isSelfReferentialSpecRoot`/`isPlatformMode` 单源判定（realpath 回环检测）；四处平台模式门禁收敛；指针生命周期免疫（恢复忽略 / `writePlatformPointer` 单点写入拦截 / 陈旧声明降级不阻断 / 残留清理自指守卫防整删 `.sillyspec` 真理源）；doctor `repo_native_chain` 画像三类。
- **现场清理**：删 `.sillyspec-platform.json` + `.sillyspec-platform-managed`（保留 local.yaml platform 凭据与 cleaned marker）。

## 验证要点

服务器 `GET /api/changes/-/spec-manifest`（shpsync token）应含本地变更全部文件且版本号随本地编辑实时递增——这是断链修复最直接的端到端证据。
