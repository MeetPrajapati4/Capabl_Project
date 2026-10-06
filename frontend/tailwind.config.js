/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        canvas: {
          dark: '#080a14',
          light: '#f8fafc',
        },
        surface: {
          dark: '#0c1021',
          light: '#ffffff',
        },
        border: {
          dark: 'rgba(255, 255, 255, 0.08)',
          light: 'rgba(15, 23, 42, 0.08)',
        },
        brand: {
          50: '#f5f3ff',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        }
      },
      boxShadow: {
        'card-dark': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        'card-light': '0 8px 24px 0 rgba(148, 163, 184, 0.15)',
        'glow-purple': '0 0 40px -10px rgba(168, 85, 247, 0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
}
