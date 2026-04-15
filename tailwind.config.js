/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        'scan-line': {
          '0%':   { top: '8px',  opacity: '1' },
          '50%':  { opacity: '0.6' },
          '100%': { top: 'calc(100% - 8px)', opacity: '1' },
        },
      },
      animation: {
        'scan-line': 'scan-line 2s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [],
}
