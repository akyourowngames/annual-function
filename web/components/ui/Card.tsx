import type { HTMLAttributes } from "react";

export default function Card({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0b0d] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.025)] transition-colors duration-300 hover:border-white/[0.14] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
