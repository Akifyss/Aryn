import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppTheme = 'light' | 'dark' | 'auto'

interface SettingsState {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'auto',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'writing-workspace:settings',
    },
  ),
)
