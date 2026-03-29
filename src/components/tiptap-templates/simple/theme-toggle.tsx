import * as React from "react"

import { Button } from "@/components/tiptap-ui-primitive/button"
import { MoonStarIcon } from "@/components/tiptap-icons/moon-star-icon"
import { SunIcon } from "@/components/tiptap-icons/sun-icon"

export interface ThemeToggleProps {
  theme: "light" | "dark"
  onToggle: () => void
}

export function ThemeToggle({ onToggle, theme }: ThemeToggleProps) {
  const isDarkMode = theme === "dark"

  return (
    <Button
      aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
      data-style="ghost"
      onClick={onToggle}
    >
      {isDarkMode ? (
        <MoonStarIcon className="tiptap-button-icon" />
      ) : (
        <SunIcon className="tiptap-button-icon" />
      )}
    </Button>
  )
}
