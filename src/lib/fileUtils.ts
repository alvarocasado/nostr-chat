export const MAX_ATTACHMENT_BYTES = 150 * 1024 // 150 KB — inline relay-safe threshold
export const MAX_RAW_FILE_BYTES = 100 * 1024   // kept for backwards-compat / tests

export interface AttachmentData {
  name: string
  type: string
  size: number  // original file size in bytes
  data: string  // data URL
}

export interface ParsedMessage {
  text: string
  attachment: AttachmentData | null
}

/**
 * Compress an image File to a JPEG data URL that fits within MAX_ATTACHMENT_BYTES.
 * Progressively reduces quality until the result is small enough.
 */
export async function compressImage(file: File, maxWidth = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')) }
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const canvas = document.createElement('canvas')
      let { naturalWidth: w, naturalHeight: h } = img
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w)
        w = maxWidth
      }
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)

      // Try progressively lower quality until under limit
      let quality = 0.85
      let dataUrl: string
      do {
        dataUrl = canvas.toDataURL('image/jpeg', quality)
        quality -= 0.1
      } while (dataUrl.length > MAX_ATTACHMENT_BYTES && quality > 0.2)

      // Always resolve — if still over the inline limit the caller will chunk it
      resolve(dataUrl)
    }
    img.src = objectUrl
  })
}

/** Encode any file as a data URL (no compression). */
export function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/** Parse message content: returns text and optional attachment. */
export function parseMessageContent(content: string): ParsedMessage {
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.attachment?.data) {
      return { text: parsed.text ?? '', attachment: parsed.attachment as AttachmentData }
    }
  } catch {
    // not a JSON attachment message
  }
  return { text: content, attachment: null }
}

/** Return a human-readable preview string for sidebar/notification use. */
export function getPreviewText(content: string): string {
  const { text, attachment } = parseMessageContent(content)
  if (attachment) {
    if (text) return text
    if (attachment.type.startsWith('image/')) return `Image: ${attachment.name}`
    if (attachment.type.startsWith('audio/')) return 'Voice message'
    return `File: ${attachment.name}`
  }
  return text
}

/** Serialize text + optional attachment into a message content string. */
export function serializeMessage(text: string, attachment?: AttachmentData | null): string {
  if (!attachment) return text
  return JSON.stringify({ text: text.trim(), attachment })
}

/** Return the best display name for a profile, falling back to a truncated pubkey. */
export function getDisplayName(
  profile: { display_name?: string; name?: string } | undefined,
  pubkey: string,
  len = 8,
): string {
  return profile?.display_name || profile?.name || pubkey.slice(0, len) + '…'
}

/** Format bytes as human-readable size string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
