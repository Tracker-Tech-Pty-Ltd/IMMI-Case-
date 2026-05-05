import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

interface KeyboardShortcuts {
  onSearch?: () => void
}

export function useKeyboard({ onSearch }: KeyboardShortcuts = {}) {
  const navigate = useNavigate()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if ((e.target as HTMLElement).isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key) {
        case "/":
          e.preventDefault()
          onSearch?.()
          break
        case "?":
          e.preventDefault()
          navigate("/design-tokens")
          break
        case "d":
          navigate("/")
          break
        case "c":
          navigate("/cases")
          break
        case "g":
          navigate("/guided-search")
          break
        case "p":
          navigate("/data-tools")
          break
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [navigate, onSearch])
}
