/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './main.jsx',
    './App.jsx',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        // RGB channel vars so opacity modifiers (bg-mise-900/50) keep working
        mise: {
          950: 'rgb(var(--mise-950) / <alpha-value>)',
          900: 'rgb(var(--mise-900) / <alpha-value>)',
          800: 'rgb(var(--mise-800) / <alpha-value>)',
          700: 'rgb(var(--mise-700) / <alpha-value>)',
          600: 'rgb(var(--mise-600) / <alpha-value>)',
          500: 'rgb(var(--mise-500) / <alpha-value>)',
          400: 'rgb(var(--mise-400) / <alpha-value>)',
          300: 'rgb(var(--mise-300) / <alpha-value>)',
          200: 'rgb(var(--mise-200) / <alpha-value>)',
        },
        ember: {
          DEFAULT: 'rgb(var(--ember) / <alpha-value>)',
          hover:   '#b83709',
        },
      },
    },
  },
  plugins: [],
}
