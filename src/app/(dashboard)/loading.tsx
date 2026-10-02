export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-32 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}
