/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1F4E79',
        secondary: '#2E75B6',
        accent: '#0EA5A4',       // teal — fresh accent (Kalibrr-ish)
        'accent-dark': '#0B807F',
      },
      boxShadow: {
        card: '0 1px 3px rgba(16,24,40,.06), 0 1px 2px rgba(16,24,40,.04)',
        'card-hover': '0 10px 30px -10px rgba(31,78,121,.25)',
        sidebar: '0 0 40px rgba(16,24,40,.06)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #1F4E79 0%, #2E75B6 100%)',
        'accent-gradient': 'linear-gradient(135deg, #0EA5A4 0%, #2E75B6 100%)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .3s ease-out',
      },
    },
  },
  plugins: [],
}
