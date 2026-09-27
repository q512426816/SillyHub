"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Counter = Counter;
const jsx_runtime_1 = require("react/jsx-runtime");
function Counter({ count, active = false, className }) {
    return ((0, jsx_runtime_1.jsx)("span", { style: active
            ? {
                borderColor: "var(--color-brand-600)",
                color: "var(--color-brand-600)",
            }
            : undefined, className: `inline-flex min-w-[1.25rem] items-center justify-center rounded-full border bg-muted px-1.5 text-xs font-medium leading-5 ${active ? "" : "border-transparent text-muted-foreground"} ${className ?? ""}`, children: count }));
}
