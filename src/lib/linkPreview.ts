// Link previews fetch the URL through a third-party service (microlink.io) and
// load an image chosen by the linked page, which reveals the URL and the
// viewer's IP. 'contacts' limits that to your own messages and your contacts'.
export type LinkPreviewMode = 'all' | 'contacts' | 'off'

export function shouldShowLinkPreview(mode: LinkPreviewMode, isOwn: boolean, senderIsContact: boolean): boolean {
  if (mode === 'off') return false
  return mode === 'all' || isOwn || senderIsContact
}
