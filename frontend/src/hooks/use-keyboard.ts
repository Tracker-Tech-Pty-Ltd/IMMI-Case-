import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"

interface KeyboardShortcuts {
  onSearch?: () => void
}

const CHORD_TIMEOUT_MS = 1000

const GO_TO_MAP: Record<string, string> = {
  d: "/",
  c: "/cases",
  s: "/guided-search",
  t: "/data-tools",
  a: "/analytics",
  j: "/judge-profiles",
  l: "/legislations",
}

export function useKeyboard({ onSearch }: KeyboardShortcuts = {}) {
  const navigate = useNavigate()
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inGoToModeRef = useRef(false)

  useEffect(() => {
    function clearChord() {
      inGoToModeRef.current = false
      if (chordTimerRef.current) {
        clearTimeout(chordTimerRef.current)
        chordTimerRef.current = null
      }
    }

    function handler(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if ((e.target as HTMLElement).isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === "/") {
        e.preventDefault()
        clearChord()
        onSearch?.()
        return
      }
      if (e.key === "?") {
        e.preventDefault()
        clearChord()
        navigate("/design-tokens")
        return
      }
      if (e.key === "Escape") {
        clearChord()
        return
      }

      if (inGoToModeRef.current) {
        const dest = GO_TO_MAP[e.key.toLowerCase()]
        clearChord()
        if (dest) {
          e.preventDefault()
          navigate(dest)
        }
        return
      }

      if (e.key === "g") {
        e.preventDefault()
        inGoToModeRef.current = true
        chordTimerRef.current = setTimeout(clearChord, CHORD_TIMEOUT_MS)
      }
    }

    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
      clearChord()
    }
  }, [navigate, onSearch])
}
