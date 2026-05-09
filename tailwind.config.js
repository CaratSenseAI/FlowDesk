/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Alias: keep older `brand-*` references working as the new navy
        brand: {
          50:  '#eeecf5',
          100: '#d6d1e8',
          200: '#aea4d0',
          300: '#7e6fb1',
          400: '#5a4990',
          500: '#3d2e74',
          600: '#2c1f5b',
          700: '#231849',
          800: '#1a1138',
          900: '#120b29',
        },
        // Deep navy/violet — primary CTA + active nav
        navy: {
          50:  '#eeecf5',
          100: '#d6d1e8',
          200: '#aea4d0',
          300: '#7e6fb1',
          400: '#5a4990',
          500: '#3d2e74',
          600: '#2c1f5b',   // primary
          700: '#231849',
          800: '#1a1138',
          900: '#120b29',
        },
        // Soft lavender body bg + outer panel tint
        lavender: {
          50:  '#f6f4fb',
          100: '#ece9f5',
          200: '#dcd7ec',   // body bg
          300: '#c4bcdf',
        },
        // Pastel task-card surfaces
        pastel: {
          blue:   '#dde6f9',
          purple: '#e3dff6',
          peach:  '#fad6c4',
          mint:   '#d5ecdb',
          rose:   '#f7d8e2',
        },
        // Chart accents
        accent: {
          violet: '#a78bfa',
          orange: '#fb923c',
          sky:    '#7dd3fc',
          mint:   '#5eead4',
        },
        ink: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft:   '0 1px 2px rgba(20,15,40,.04), 0 6px 24px rgba(45,31,91,.06)',
        card:   '0 1px 2px rgba(20,15,40,.04), 0 12px 40px -12px rgba(45,31,91,.10)',
        panel:  '0 8px 30px rgba(45,31,91,.08), inset 0 0 0 1px rgba(255,255,255,.55)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: 0, transform: 'translateY(2px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'pop-in':  { '0%': { opacity: 0, transform: 'scale(.98)' }, '100%': { opacity: 1, transform: 'scale(1)' } },
      },
      animation: {
        'fade-in': 'fade-in .25s ease-out both',
        'pop-in':  'pop-in .15s ease-out both',
      },
    },
  },
  plugins: [],
};
