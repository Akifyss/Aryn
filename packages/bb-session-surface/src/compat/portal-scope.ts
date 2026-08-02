import { usePreferredTheme } from './theme'

export function usePortalScopeProps(): {
  'data-bb-portaled-overlay': ''
  'data-bb-plugin-root': ''
  'data-bb-theme': 'dark' | 'light'
} {
  return {
    'data-bb-portaled-overlay': '',
    'data-bb-plugin-root': '',
    'data-bb-theme': usePreferredTheme(),
  }
}
