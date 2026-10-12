/**
 * clipboard.ts —— 剪贴板写入（安全上下文 Async Clipboard API + 非安全上下文降级）。
 *
 * 2026-10-12-clipboard-fallback（24h 风险审查 P2-5）：`navigator.clipboard` 仅在
 * 安全上下文（HTTPS/localhost）存在——本仓明示以纯 HTTP 局域网形态部署
 * （lib/api.ts 注释自证），凭据复制（api-keys/mcp-tokens/runtimes）在该主部署
 * 形态下调用即抛 TypeError。降级路径：隐藏 textarea + `document.execCommand('copy')`
 * （legacy API，非安全上下文可用；已废弃但为该形态下唯一程序化写入通道）。
 *
 * 仓内其它复制点（daemon/copy-button 等）仍为旧实现，后续触碰时迁移本 helper。
 */

/**
 * 写入文本到剪贴板。
 *
 * 安全上下文走 Async Clipboard API；非安全上下文走 textarea 选区 + execCommand
 * 降级（恢复既有选区、清理临时节点）。两条路径都失败时抛错——调用方既有 catch
 * （errMessage 横幅）承接，本函数不吞错。
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 非安全上下文降级：execCommand('copy') 只复制当前 DOM 选区，故借用临时
  // textarea 承载文本；readonly 防移动端键盘弹出，fixed+透明避免布局闪动。
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("浏览器拒绝了剪贴板写入（execCommand copy 返回 false）");
    }
  } finally {
    document.body.removeChild(textarea);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }
}
