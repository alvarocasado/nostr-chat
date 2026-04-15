import { useState } from 'react'
import { useNostrStore } from './store/nostrStore'
import { LoginScreen } from './components/Auth/LoginScreen'
import { Sidebar } from './components/Chat/Sidebar'
import { MessageThread } from './components/Chat/MessageThread'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { AddChannelModal } from './components/Chat/AddChannelModal'
import { AddContactModal } from './components/Chat/AddContactModal'

function App() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const {
    publicKey,
    showSettings, setShowSettings,
    showAddChannel, setShowAddChannel,
    showAddContact, setShowAddContact,
  } = useNostrStore()

  if (!publicKey) {
    return <LoginScreen />
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
      {showAddContact && (
        <AddContactModal onClose={() => setShowAddContact(false)} />
      )}
    </div>
  )
}

export default App
