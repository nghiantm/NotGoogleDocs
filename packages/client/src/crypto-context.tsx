import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { deriveSubKey } from '@collab/crdt'

interface CryptoContextValue {
  opKey: CryptoKey | null
  isUnlocked: boolean
}

const CryptoContext = createContext<CryptoContextValue>({ opKey: null, isUnlocked: false })

export function CryptoProvider({
  masterKey,
  children,
}: {
  masterKey: CryptoKey | null
  children: ReactNode
}) {
  const [opKey, setOpKey] = useState<CryptoKey | null>(null)

  useEffect(() => {
    if (!masterKey) {
      setOpKey(null)
      return
    }
    deriveSubKey(masterKey, 'op-encryption').then(setOpKey)
  }, [masterKey])

  return (
    <CryptoContext.Provider value={{ opKey, isUnlocked: opKey !== null }}>
      {children}
    </CryptoContext.Provider>
  )
}

export function useCryptoContext(): CryptoContextValue {
  return useContext(CryptoContext)
}
