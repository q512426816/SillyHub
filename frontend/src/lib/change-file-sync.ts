// 变更文件树「刷新」同步回执 → 提示文案（2026-10-16-change-files-sync-result）。
//
// 独立小模块（不引 api/会话等重依赖）：`change-file-tree.tsx` 消费、单测直接跑
// 真实函数。类型对齐 backend change/schema.py ChangeFileSyncResult——后端在
// sync=1 时随 GET files 响应带回同步执行回执（triggered/ok/reason/stderr_tail）。

export type ChangeFileSyncResult = {
  /** RPC 是否已发出（false = 未绑定 / daemon 离线，等效未执行） */
  triggered: boolean;
  /** true=daemon 执行成功；false=执行失败或超时；null=已触发但防抖跳过或未触发 */
  ok: boolean | null;
  /** 机读原因短码（no_binding / rpc_timeout / cli_failed / skipped_debounced / ...） */
  reason: string | null;
  /** CLI 失败输出尾段（daemon 已截短，后端兜底截断） */
  stderr_tail: string | null;
};

/** 机读原因 → 中文标注；未收录的新 reason 原样透出（宁多勿吞）。 */
const SYNC_REASON_CN: Record<string, string> = {
  no_binding: "当前账号未绑定本机 daemon",
  daemon_offline: "绑定的 daemon 离线",
  rpc_timeout: "daemon 响应超时",
  rpc_remote_error: "daemon 拒绝执行（可能版本过旧）",
  runtime_offline: "daemon 连接中断",
  cli_failed: "本机 sillyspec CLI 执行失败",
  no_workspace_root: "daemon 尚未认领该工作区目录",
  exception: "同步链路异常",
};

/**
 * 同步回执 → 警示文案；无需提示返回 null。
 *
 * 不提示的三种情形：纯读/旧后端（回执 null）、执行成功（ok=true）、防抖跳过
 * （已触发且 ok=null——刚同步过或正在同步，数据新鲜度足够）。
 * 提示两档：「同步未执行」（triggered=false，未绑定/离线）；「同步未完成」
 * （ok=false，含 CLI 失败尾段）。
 */
export function changeFileSyncWarningText(sr: ChangeFileSyncResult | null): string | null {
  if (!sr) return null;
  if (sr.ok === true) return null;
  if (sr.ok === null && sr.triggered) return null; // skipped_in_flight / skipped_debounced
  const label = (sr.reason && SYNC_REASON_CN[sr.reason]) || sr.reason || "未知原因";
  if (sr.ok === false) {
    const tail = sr.stderr_tail ? `：${sr.stderr_tail}` : "";
    return `同步未完成：${label}${tail}（文件树为平台镜像数据，可稍后重试）`;
  }
  return `同步未执行：${label}（文件树为平台镜像数据）`;
}
