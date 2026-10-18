/**
 * Route-level suspense fallback — the shape of the page before its data
 * exists.
 *
 * A server component on purpose: it renders before any client JS hydrates,
 * so importing the client-side `Skeleton` from the kit would drag the whole
 * kit graph into this critical path. The `skeleton` utility class in
 * globals.css is the SAME shimmer the kit uses, so the fallback and the
 * in-page skeletons are visually identical — the page does not "swap
 * style" the moment data lands.
 *
 * The layout mirrors the overview (heading block, four stat cards, two
 * panels) because that is the first screen people meet; every other route
 * under the shell degrades into the same calm placeholder rather than a
 * blank canvas.
 */
export default function Loading() {
  return (
    <div className="space-y-6 animate-in fade-in-0 duration-200" aria-busy="true" aria-label="Loading">
      {/* Heading */}
      <div className="space-y-2">
        <div className="skeleton h-7 w-56" />
        <div className="skeleton h-4 w-80 max-w-full" />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="panel edge-lit space-y-4 p-5">
            <div className="flex items-start justify-between">
              <div className="skeleton size-10 rounded-xl" />
              <div className="skeleton h-3 w-14" />
            </div>
            <div className="skeleton h-8 w-24" />
            <div className="skeleton h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>

      {/* Main panels */}
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="panel xl:col-span-3">
          <div className="border-b border-line px-5 py-4">
            <div className="skeleton h-4 w-36" />
          </div>
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="skeleton h-9" />
            ))}
          </div>
        </div>
        <div className="space-y-6 xl:col-span-2">
          <div className="panel">
            <div className="border-b border-line px-5 py-4">
              <div className="skeleton h-4 w-28" />
            </div>
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton h-10" />
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="border-b border-line px-5 py-4">
              <div className="skeleton h-4 w-24" />
            </div>
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="skeleton h-7" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
