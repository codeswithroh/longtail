// Shown the instant a tab is clicked, while the page's data streams in.
export default function Loading() {
  const block = "animate-pulse rounded-xl border border-border bg-surface";
  return (
    <div className="space-y-4" aria-busy aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${block} h-[132px]`} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${block} h-[280px] lg:col-span-2`} />
        <div className={`${block} h-[280px]`} />
      </div>
      <div className={`${block} h-[220px]`} />
    </div>
  );
}
