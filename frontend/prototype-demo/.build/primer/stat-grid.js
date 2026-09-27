"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatGrid = StatGrid;
const jsx_runtime_1 = require("react/jsx-runtime");
const TONE_COLOR = {
    default: undefined,
    brand: "var(--color-brand-600)",
    warning: "hsl(var(--warning))",
};
function StatGrid({ items, className }) {
    return ((0, jsx_runtime_1.jsx)("div", { className: `grid divide-x overflow-hidden rounded-lg border ${className ?? ""}`, style: {
            gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
            borderColor: "hsl(var(--border))",
        }, children: items.map((item) => ((0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-1 px-4 py-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs text-muted-foreground", children: item.label }), (0, jsx_runtime_1.jsx)("div", { className: "font-mono text-2xl font-semibold leading-8", style: item.tone && item.tone !== "default" ? { color: TONE_COLOR[item.tone] } : undefined, children: item.value })] }, item.label))) }));
}
