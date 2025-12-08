import React from "react";

export default function MVPDemoPanel() {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg h-full flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-950/60">
        <h3 className="font-['Arimo',sans-serif] text-[12px] text-neutral-50 tracking-[0.08em]">MVP Demo</h3>
      </div>
      <div className="flex-1 p-4 text-neutral-200 font-['Arimo',sans-serif] text-[11.5px]">
        MVP placeholder panel. Wire specific demo content here.
      </div>
    </div>
  );
}
