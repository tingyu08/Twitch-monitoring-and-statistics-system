import React, { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface DashboardCardWrapperProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  title?: string;
  className?: string;
  // react-grid-layout props
  style?: React.CSSProperties;
  onMouseDown?: React.MouseEventHandler;
  onMouseUp?: React.MouseEventHandler;
  onTouchEnd?: React.TouchEventHandler;
  "data-grid"?: any; // RGL uses this
}

export const DashboardCardWrapper = React.forwardRef<
  HTMLDivElement,
  DashboardCardWrapperProps
>(({ children, title, className, style, ...props }, ref) => {
  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        "bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden flex flex-col shadow-lg transition-shadow hover:shadow-slate-800/50",
        className
      )}
      {...props}
    >
      <div className="drag-handle h-6 w-full cursor-grab active:cursor-grabbing bg-slate-800 flex justify-center items-center hover:bg-slate-700/50 transition-colors group">
        <div className="w-8 h-1 bg-slate-600 rounded-full group-hover:bg-slate-500 transition-colors" />
      </div>
      <div className="flex-1 p-4 overflow-hidden relative flex flex-col">
        {title && (
          <h3 className="text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">
            {title}
          </h3>
        )}
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
});

DashboardCardWrapper.displayName = "DashboardCardWrapper";
