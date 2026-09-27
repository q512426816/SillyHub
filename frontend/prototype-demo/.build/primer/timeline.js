"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimelineItem = TimelineItem;
exports.Timeline = Timeline;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * Timeline / TimelineItem —— primer 事件时间线（2026-09-26-core-pages-visual-redesign FR-01 / FR-04）。
 *
 * GitHub timeline 范式：左侧 3px 竖线 + 节点圆标 + 事件标题/时间 + 可折叠日志块
 * （children），tone 区分 default/current/success 三态。业务事件类型映射由消费页面做。
 */
const React = __importStar(require("react"));
const TONE_RING = {
    default: "hsl(var(--muted-foreground))",
    current: "var(--color-brand-600)",
    success: "hsl(var(--success))",
};
function TimelineItem({ icon, title, time, tone = "default", children, }) {
    const [open, setOpen] = React.useState(false);
    return ((0, jsx_runtime_1.jsxs)("li", { className: "relative flex gap-3 pb-5 last:pb-0", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col items-center", children: [(0, jsx_runtime_1.jsx)("div", { className: "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border", style: {
                            borderColor: TONE_RING[tone],
                            color: TONE_RING[tone],
                            backgroundColor: "hsl(var(--card))",
                        }, children: icon }), (0, jsx_runtime_1.jsx)("div", { "aria-hidden": "true", className: "mt-1 w-px flex-1", style: { backgroundColor: "hsl(var(--border))" } })] }), (0, jsx_runtime_1.jsxs)("div", { className: "min-w-0 flex-1 pt-1", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-x-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-sm font-medium", children: title }), time ? ((0, jsx_runtime_1.jsx)("div", { className: "text-xs text-muted-foreground", children: time })) : null] }), children ? ((0, jsx_runtime_1.jsxs)("div", { className: "mt-1.5", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setOpen((v) => !v), className: "text-xs text-muted-foreground hover:underline", children: open ? "收起详情" : "展开详情" }), open ? ((0, jsx_runtime_1.jsx)("div", { className: "mt-1.5 whitespace-pre-wrap rounded-md border px-3 py-2 font-mono text-xs leading-5", style: { borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--muted))" }, children: children })) : null] })) : null] })] }));
}
function Timeline({ children, className }) {
    return (0, jsx_runtime_1.jsx)("ul", { className: `flex flex-col ${className ?? ""}`, children: children });
}
