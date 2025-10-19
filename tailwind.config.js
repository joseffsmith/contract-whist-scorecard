module.exports = {
    mode: 'jit',
    darkMode: 'class', // Enable class-based dark mode
    purge: {
        enabled: process.env.NODE_ENV === 'production',
        safeList: [],
        content: ['./index.html', './src/**/*.tsx', './src/**/*.ts'],
    },
    theme: {
        extend: {
            colors: {
                // Custom dark mode colors if needed
                dark: {
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
                }
            }
        }
    },
    variants: {},
    plugins: [],
}