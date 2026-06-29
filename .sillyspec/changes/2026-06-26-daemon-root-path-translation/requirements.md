---
author: WhaleFall
created_at: 2026-06-26 12:32:47
change: 2026-06-26-daemon-root-path-translation
---

# Requirements: daemon root_path 翻译修复

## 功能需求（引用 design 决策 D-xxx@v1）
- **FR-01（D-001）**：backend 下发 daemon 的 root_path 用 `resolve_root_path_for_daemon(root_path, path_source)` 改写——server-local 走 container→host（`/host-projects` → `HOST_PATH_PREFIX`）；daemon-client 原样透传。
- **FR-02（D-002）**：daemon 收到 root_path 后自动加入运行时 allowed_roots（动态白名单），config 静态 allowed_roots 不动作兜底。
- **FR-03（D-003）**：batch（prepareWorkspace/TaskRunner）+ interactive（session-manager cwd）两路径都改。
- **FR-04（D-004）**：不新增 daemon 端 root_path 翻译（不可移植）；`translateSpecRoot`（prompt 的 spec_root）保持不动。
- **FR-05**：复用 `HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX`，不新增 env。
- **FR-06**：跨平台（Windows/Linux/macOS）；裸机部署（未配前缀）改写函数原样返回兼容。

## 验收标准（见 design §7）
1. batch lease 执行：daemon cwd=项目根（F:\WorkNew\SillyHub 等价），CC 能 find scan-docs/page.tsx，run 正常完成。
2. interactive session：cwd 同样是项目根，CC 能读源码。
3. daemon-client workspace：root_path 原样透传，行为不回归。
4. daemon allowed_roots：执行期运行时白名单含本次 root_path，config 静态值不变。
5. 裸机兼容：未配 HOST_PATH_PREFIX 时原样返回。
6. backend scanner 不回归：scan_docs/knowledge/task 仍走 resolve_root_path_for_server。
7. 单测：resolve_root_path_for_daemon + ensureAllowedRoot 全过。

## 剩余风险（execute 确认，非阻塞）
- X-002：`placement.py:258/484` 函数签名能否拿到 path_source。
- X-003：`context_builder.py --dir` 命令执行环境（daemon vs 容器内），影响是否改写。
- 旧 daemon（未升级 ensureAllowedRoot）不兼容——同变更交付升级。
