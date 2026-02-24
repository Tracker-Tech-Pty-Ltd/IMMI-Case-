import { useState, useCallback } from "react"
import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Topbar } from "./Topbar"
import { MobileNav } from "./MobileNav"
import { GlobalSearch } from "@/components/shared/GlobalSearch"
import { useKeyboard } from "@/hooks/use-keyboard"
import "@/hooks/use-theme-preset" // eagerly apply stored theme preset on load

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const handleSearchClick = useCallback(() => {
    setSearchOpen(true)
    setMobileOpen(false)
  }, [])

  useKeyboard({ onSearch: handleSearchClick })

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-white"
      >
        跳到主要內容
      </a>
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile nav drawer */}
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Main content */}
      <div className="lg:pl-56">
        <Topbar
          onMenuClick={() => setMobileOpen(true)}
          onSearchClick={handleSearchClick}
        />
        <main id="main-content" className="mx-auto max-w-7xl p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
