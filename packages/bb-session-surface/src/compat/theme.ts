import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from 'react'
import type { BbTheme } from '../contracts'

export type Theme = BbTheme

const BbThemeContext = createContext<Theme>('light')

export function BbThemeProvider({
  children,
  theme,
}: {
  children: ReactNode
  theme: Theme
}) {
  return createElement(BbThemeContext.Provider, { value: theme }, children)
}

export function usePreferredTheme(): Theme {
  return useContext(BbThemeContext)
}

export function useAppThemeEpoch(): number {
  return usePreferredTheme() === 'dark' ? 1 : 0
}
