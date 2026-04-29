import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { useNostrStore } from './store/nostrStore'
import { LoginScreen } from './components/Auth/LoginScreen'
import { Sidebar } from './components/Chat/Sidebar'
import { MessageThread } from './components/Chat/MessageThread'
import { SettingsScreen } from './components/Settings/SettingsScreen'
import { AddChannelModal } from './components/Chat/AddChannelModal'
import { AddContactModal } from './components/Chat/AddContactModal'
import { UpdatePrompt } from './components/UpdatePrompt'
import { CallProvider, useCallContext } from './contexts/CallContext'
import { IncomingCall } from './components/Call/IncomingCall'
import { CallOverlay } from './components/Call/CallOverlay'
import { ProfileCard } from './components/Chat/ProfileCard'
import { getActivePubkey, openUserDb, evictOldMessages } from './lib/userDb'

function IceFailureBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { iceConnFailed, dismissIceFailure } = useCallContext()
  if (!iceConnFailed) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[calc(100%-2rem)] bg-gray-900 border border-amber-500/40 rounded-2xl px-4 py-3 shadow-2xl flex items-start gap-3">
      <span className="text-amber-400 flex-shrink-0 text-base leading-5">⚠️</span>
      <p className="flex-1 text-sm text-white min-w-0">
        Call connection failed. If this keeps happening, try configuring a relay server in{' '}
        <button
          onClick={() => { dismissIceFailure(); onOpenSettings() }}
          className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
        >
          Settings → Calls
        </button>
        .
      </p>
      <button
        onClick={dismissIceFailure}
        className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  )
}

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
  const [isHydrating, setIsHydrating] = useState(true)
  const [contactLinkNpub, setContactLinkNpub] = useState<string | null>(null)

  const {
    publicKey,
    activeSettingsTab, setActiveSettingsTab,
    showAddChannel, setShowAddChannel,
    showAddContact, setShowAddContact,
  } = useNostrStore()

  const openCallSettings = useCallback(() => {
    setActiveSettingsTab('calls')
  }, [setActiveSettingsTab])

  useEffect(() => {
    const npub = consumeContactParam()
    if (npub) setContactLinkNpub(npub)
  }, [])

  // Bootstrap: open the previously active user's DB and rehydrate Zustand.
  useEffect(() => {
    async function bootstrap() {
      const pubkey = getActivePubkey()
      if (pubkey) {
        openUserDb(pubkey)
await evictOldMessages()
        await useNostrStore.persist.rehydrate()
      }
      setIsHydrating(false)
    }
    bootstrap()
  }, [])

  if (isHydrating) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!publicKey) {
    return (
      <>
        <LoginScreen />
        <UpdatePrompt />
      </>
    )
  }

  return (
    <CallProvider>
      <div className="flex h-full w-full bg-gray-950 overflow-hidden pb-16 md:pb-0">
        <Sidebar />
        {activeSettingsTab ? <SettingsScreen /> : <MessageThread />}

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

      <IncomingCall />
      <CallOverlay />
      <ProfileCard />
      <IceFailureBanner onOpenSettings={openCallSettings} />
    </CallProvider>
  )
}

export default App
