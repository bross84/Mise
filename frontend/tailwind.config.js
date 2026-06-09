/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './main.jsx',
    './App.jsx',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        mise: {
          950: '#191919',
          900: '#222222',
          800: '#263328',
          700: '#33673B',
          600: '#9A6D38',
          500: '#9a8d89',
          400: '#b8aaa6',
          300: '#D8CBC7',
          200: '#e8ddd9',
        },
        ember: {
          DEFAULT: '#CC3F0C',
          hover:   '#b83709',
        },
      },
    },
  },
  plugins: [],
}
