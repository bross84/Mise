import { Link, Route, Routes, useLocation } from 'react-router-dom'
import AddRecipe from './src/pages/AddRecipe.jsx'
import IngredientDatabase from './src/pages/IngredientDatabase.jsx'
import RecipeBrowser from './src/pages/RecipeBrowser.jsx'
import RecipeDetail from './src/pages/RecipeDetail.jsx'
import Settings from './src/pages/Settings.jsx'
import { useThemeContext } from './src/context/ThemeContext.jsx'
import { Sun, Moon } from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { label: 'Recipes', to: '/' },
  { label: 'Add Recipe', to: '/add' },
  { label: 'Ingredients', to: '/ingredients' },
  { label: 'Settings', to: '/settings' },
]

function ThemeToggle({ compact = false }) {
  const { theme, setTheme } = useThemeContext()
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="rounded border border-mise-800 p-1.5 text-mise-500 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex w-full items-center gap-2.5 rounded border border-mise-800 px-3 py-2 text-sm text-mise-500 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
}

function App() {
  const location = useLocation()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const isNavItemActive = (to) => {
    if (to === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/recipe/')
    }
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }

  const linkClassName = (to) =>
    [
      'block py-2 pr-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
      isNavItemActive(to)
        ? 'rounded border-l-2 border-ember pl-3 text-mise-300'
        : 'pl-[14px] text-mise-500 hover:text-mise-300',
    ].join(' ')

  return (
    <div className="min-h-screen bg-mise-950 text-mise-300">
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-mise-800 bg-mise-950/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between">
          <p className="font-display text-2xl font-bold text-mise-300">Mise</p>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <button
              type="button"
              onClick={() => setIsMenuOpen((current) => !current)}
              className="rounded border border-mise-800 px-3 py-1.5 text-sm font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Toggle main menu"
              aria-expanded={isMenuOpen}
              aria-controls="main-navigation"
            >
              Menu
            </button>
          </div>
        </div>
      </header>

      {isMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-30 bg-mise-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember md:hidden"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      <aside
        className={[
          'fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-mise-800 bg-mise-950/95 px-4 py-6 backdrop-blur transition-transform',
          isMenuOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        ].join(' ')}
      >
        <div className="px-3">
          <p className="font-display text-3xl font-bold text-mise-300">Mise</p>
        </div>

        <nav id="main-navigation" aria-label="Main navigation" className="mt-8 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={linkClassName(item.to)}
              onClick={() => setIsMenuOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto px-3 pt-4 border-t border-mise-800">
          <ThemeToggle />
        </div>
      </aside>

      <main className="min-h-screen px-4 pb-6 pt-20 md:ml-64 md:p-8">
        <Routes>
          <Route path="/" element={<RecipeBrowser />} />
          <Route path="/recipe/:id" element={<RecipeDetail />} />
          <Route path="/add" element={<AddRecipe />} />
          <Route path="/ingredients" element={<IngredientDatabase />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
