/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--color-ink)',
        panel: 'var(--color-panel)',
        canvas: 'var(--color-canvas)',
        accent: 'var(--color-accent)',
        muted: 'var(--color-muted)',
        border: 'var(--color-border)',
      },
      boxShadow: {
        soft: '0 14px 36px rgb(15 31 48 / 8%)',
      },
    },
  },
  plugins: [],
};
