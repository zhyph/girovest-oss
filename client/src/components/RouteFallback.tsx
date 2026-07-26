import { Loader2Icon } from 'lucide-react'

export function RouteFallback() {
  return (
    <div className="flex h-full min-h-40 w-full items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
