/**
 * 路由段 Suspense 骨架(性能优化 2026-07-22)。
 *
 * 此前零 loading.tsx,所有页面 client 自管 spinner,路由切换浏览器停在上一帧直到
 * 新页 JS + 首请求就绪(白屏感)。本文件作为 (dashboard) 段的 Suspense fallback,
 * 在路由切换时立即流出骨架,改善感知性能。纯 server component、零依赖、零业务
 * 逻辑;样式在 globals.css(.silly-route-loading),尊重 prefers-reduced-motion。
 * 各重页面如需更精细骨架可加自己的 loading.tsx 覆盖。
 */
export default function Loading() {
  return (
    <div className="silly-route-loading">
      <span className="silly-route-loading__spinner" />
      <span>加载中…</span>
    </div>
  );
}
