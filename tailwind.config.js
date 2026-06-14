/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:'#f0fdf4',100:'#dcfce7',200:'#bbf7d0',300:'#86efac',400:'#4ade80',
          500:'#22c55e',600:'#16a34a',700:'#15803d',800:'#166534',900:'#14532d',
        },
        harvest: {
          50:'#fbf4ea',100:'#f6e3c6',200:'#eecb94',400:'#e0913f',
          500:'#c8601a',600:'#a94d12',700:'#86400f',
        },
        ink: '#0a0c0f',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-hover': '0 6px 16px -4px rgb(15 23 42 / 0.12)',
      },
    },
  },
  plugins: [],
}
