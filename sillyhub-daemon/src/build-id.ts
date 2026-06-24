/**
 * build-id.ts —— daemon 自身构建标识（git short SHA）。
 *
 * 用途：preflight（src/preflight.ts）启动前对比本地构建版本与服务器
 * `${server_url}/daemon/latest.json` 的 version 字段（即发布时的 git SHA），
 * 不一致时自动下载新 bundle 替换 ~/.sillyhub/daemon/bin/sillyhub-daemon.js。
 *
 * 取值来源（按构建形态）：
 *   - 开发 / 直接 `node dist/cli.js`：本文件占位常量 `"dev"`。preflight 检测到
 *     `"dev"` 会跳过 daemon 自更新（本地开发无 SHA 注入，跑了也只是徒劳下载）。
 *   - release bundle（scripts/build-bundle.sh）：脚本在 `pnpm build` 前用
 *     `git rev-parse --short HEAD` 生成 SHA 覆盖本常量，经 tsc 编译进 dist →
 *     ncc 内联进单文件 bundle。运行时读到真实 SHA，preflight 正常自更新。
 *
 * 写入策略（build-bundle.sh）：仅在 SHA 变化时改写本文件，避免重复构建污染
 * src tree。占位值 `"dev"` 提交进 git，保证 clone 后 tsc 即可编译（不依赖
 * 先跑 build-bundle.sh）。
 *
 * @module build-id
 */

/**
 * 构建标识。开发态占位 `"dev"`，release bundle 被 build-bundle.sh 覆盖为
 * 形如 `"8961f96"` 的 git short SHA。
 */
export const BUILD_ID: string = 'dev';
