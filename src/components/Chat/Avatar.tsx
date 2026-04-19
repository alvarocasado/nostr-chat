interface AvatarProps {
  picture?: string
  name?: string
  pubkey: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
}

function getColor(pubkey: string) {
  const colors = [
    'bg-purple-600', 'bg-violet-600', 'bg-indigo-600',
    'bg-blue-600', 'bg-cyan-600', 'bg-teal-600',
    'bg-pink-600', 'bg-rose-600', 'bg-orange-600',
  ]
  const idx = parseInt(pubkey.slice(0, 8), 16) % colors.length
  return colors[idx]
}

function getInitials(name?: string, pubkey?: string): string {
  if (name && name.trim()) return name.trim()[0].toUpperCase()
  if (pubkey) return pubkey.slice(0, 2).toUpperCase()
  return '?'
}

function isSafeImageUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export function Avatar({ picture, name, pubkey, size = 'md' }: AvatarProps) {
  if (picture && isSafeImageUrl(picture)) {
    return (
      <img
        src={picture}
        alt={name || pubkey}
        referrerPolicy="no-referrer"
        className={`${sizeClasses[size]} rounded-full object-cover flex-shrink-0`}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
          e.currentTarget.nextElementSibling?.removeAttribute('style')
        }}
      />
    )
  }

  return (
    <div
      className={`${sizeClasses[size]} ${getColor(pubkey)} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`}
    >
      {getInitials(name, pubkey)}
    </div>
  )
}
