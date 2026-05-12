/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceff4',
          200: '#d3d8e0',
          300: '#a8b1bf',
          400: '#7a8597',
          500: '#566173',
          600: '#3d4654',
          700: '#2a313c',
          800: '#1c222b',
          900: '#11151c',
          950: '#080b10',
        },
        accent: {
          sent: '#f59e0b',
          recv: '#22c55e',
          tool: '#a855f7',
          text: '#38bdf8',
          err: '#ef4444',
        },
      },
    },
  },
  plugins: [],
};
