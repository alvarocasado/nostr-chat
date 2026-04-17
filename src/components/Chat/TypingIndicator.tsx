interface TypingIndicatorProps {
  typists: string[]
  profiles: Record<string, { name?: string; display_name?: string } | undefined>
}

export function TypingIndicator({ typists, profiles }: TypingIndicatorProps) {
  if (typists.length === 0) return <div className="h-5" />

  const names = typists.map(pk => {
    const p = profiles[pk]
    return p?.display_name || p?.name || pk.slice(0, 8) + '…'
  })

  const label =
    names.length === 1 ? `${names[0]} is typing` :
    names.length === 2 ? `${names[0]} and ${names[1]} are typing` :
                         `${names[0]} and ${names.length - 1} others are typing`

  return (
    <div className="h-5 flex items-center gap-1.5 px-4">
      <span className="text-xs text-gray-500 italic">{label}</span>
      <span className="flex gap-0.5 items-end mb-0.5">
        <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce [animation-delay:0ms]" />
        <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce [animation-delay:150ms]" />
        <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce [animation-delay:300ms]" />
      </span>
    </div>
  )
}
