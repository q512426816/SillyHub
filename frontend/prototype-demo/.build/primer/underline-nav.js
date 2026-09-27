"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnderlineNav = UnderlineNav;
const jsx_runtime_1 = require("react/jsx-runtime");
const counter_1 = require("./counter");
function UnderlineNav({ items, value, onChange, className, }) {
    return ((0, jsx_runtime_1.jsx)("div", { role: "tablist", className: `flex items-center gap-1 border-b ${className ?? ""}`, style: { borderBottomColor: "hsl(var(--border))" }, onKeyDown: (e) => {
            if (e.key !== "Enter" && e.key !== " ")
                return;
            const idx = items.findIndex((item) => item.key === value);
            const next = items[(idx + 1) % items.length];
            if (next) {
                e.preventDefault();
                onChange(next.key);
            }
        }, children: items.map((item) => {
            const active = item.key === value;
            return ((0, jsx_runtime_1.jsxs)("button", { type: "button", role: "tab", "aria-selected": active, tabIndex: active ? 0 : -1, onClick: () => onChange(item.key), className: `relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${active ? "font-semibold" : "font-medium hover:bg-muted/60"}`, style: {
                    color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                    borderBottomColor: active
                        ? "var(--color-brand-600)"
                        : "transparent",
                }, children: [item.label, typeof item.counter === "number" ? ((0, jsx_runtime_1.jsx)(counter_1.Counter, { count: item.counter, active: active })) : null] }, item.key));
        }) }));
}
