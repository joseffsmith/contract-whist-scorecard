import { extendTheme } from '@mui/joy/styles';

// Combined theme with both light and dark color schemes
export const theme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        neutral: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        background: {
          body: '#ffffff',
          surface: '#f8fafc',
          popup: '#ffffff',
          level1: '#f1f5f9',
          level2: '#e2e8f0',
          level3: '#cbd5e1',
        },
        text: {
          primary: '#0f172a',
          secondary: '#475569',
          tertiary: '#64748b',
        },
      },
    },
    dark: {
      palette: {
        primary: {
          50: '#1e3a8a',
          100: '#1e40af',
          200: '#1d4ed8',
          300: '#2563eb',
          400: '#3b82f6',
          500: '#60a5fa',
          600: '#93c5fd',
          700: '#bfdbfe',
          800: '#dbeafe',
          900: '#eff6ff',
        },
        neutral: {
          50: '#0f172a',
          100: '#1e293b',
          200: '#334155',
          300: '#475569',
          400: '#64748b',
          500: '#94a3b8',
          600: '#cbd5e1',
          700: '#e2e8f0',
          800: '#f1f5f9',
          900: '#f8fafc',
        },
        background: {
          body: '#0f172a',
          surface: '#1e293b',
          popup: '#334155',
          level1: '#334155',
          level2: '#475569',
          level3: '#64748b',
        },
        text: {
          primary: '#f8fafc',
          secondary: '#cbd5e1',
          tertiary: '#94a3b8',
        },
      },
    },
  },
});

// Legacy exports for backwards compatibility
export const lightTheme = theme;
export const darkTheme = theme;
