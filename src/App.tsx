import { useState, useEffect } from 'react'
import { useNostrStore } from './store/nostrStore'
import { LoginScreen } from './components/Auth/LoginScreen'
import { Sidebar } from './components/Chat/Sidebar'
import { MessageThread } from './components/Chat/MessageThread'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { AddChannelModal } from './components/Chat/AddChannelModal'
import { AddContactModal } from './components/Chat/AddContactModal'
import { UpdatePrompt } from './components/UpdatePrompt'

/** Read and remove the ?contact= param from the URL without a page reload. */
function consumeContactParam(): string | null {
  const params = new URLSearchParams(window.location.search)
  const npub = params.get('contact')
  if (npub) {
    params.delete('contact')
    const newSearch = params.toString()
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '')
    history.replaceState(null, '', newUrl)
  }
  return npub
}

function App() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [contactLinkNpub, setContactLinkNpub] = useState<string | null>(null)

  const {
    publicKey,
    showSettings, setShowSettings,
    showAddChannel, setShowAddChannel,
    showAddContact, setShowAddContact,
  } = useNostrStore()

  // Handle ?contact=npub1... share links
  useEffect(() => {
    const npub = consumeContactParam()
    if (npub) setContactLinkNpub(npub)
  }, [])

  if (!publicKey) {
    return (
      <>
        <LoginScreen />
        <UpdatePrompt />
      </>
    )
  }

  return (
    <div className="flex h-full w-full bg-gray-950 overflow-hidden">
      <Sidebar isOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
      <MessageThread onOpenSidebar={() => setMobileSidebarOpen(true)} />

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
      {showAddChannel && (
        <AddChannelModal onClose={() => setShowAddChannel(false)} />
      )}
      {(showAddContact || contactLinkNpub) && (
        <AddContactModal
          initialNpub={contactLinkNpub ?? undefined}
          onClose={() => { setShowAddContact(false); setContactLinkNpub(null) }}
        />
      )}
      <UpdatePrompt />
    </div>
  )
}

export default App
