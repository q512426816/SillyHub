/**
 * linked-repos-path.ts —— 关联仓 RPC 路径形态校验助手（纯函数）。
 *
 * 2026-10-11-linked-repos-path-guard（24h 审查 P3-2）：daemon 的
 * linked_repos_snapshot/sync 此前对 root_path 只做非空校验即用作外部 CLI 的
 * cwd 与参数、rel_path/abs_path 仅 trim 直传写命令；backend 侧 MyPathUpdate.path
 * 只限长度不限形态——本助手提供第二道边界（纵深防御），只拦**相对/垃圾形态**
 * （相对路径会让 execFile cwd 漂移到 daemon 进程目录、行为未定义）。
 *
 * 不用裸 `path.isAbsolute`：它平台相关（Linux 上拒 `C:/x` 盘符形态），而 CI
 * （ubuntu-latest）与生产 fixture 都会出现 Windows 盘符字符串——三形态正则
 * 保证任意运行平台上判定一致：
 * - POSIX 根：`/ws`
 * - Windows 盘符：`C:/x`、`C:\x`
 * - UNC：`\\srv\share\x`（反斜双）或 `//srv/share/x`（正斜双）
 *
 * 绝对路径的**内容**不加白名单——用户登记本机任意仓库路径是功能本体，机器
 * 归属校验归 backend 绑定行语义。
 */

/** 绝对路径形态：盘符 / UNC 反斜双 / UNC 正斜双 / POSIX 根，任一起头即真。 */
const ABSOLUTE_LIKE_RE = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/|\/)/;

/** 是否为绝对路径形态（平台无关；空串与相对形态 false）。 */
export function isAbsoluteLikePath(p: string): boolean {
  return ABSOLUTE_LIKE_RE.test(p);
}
