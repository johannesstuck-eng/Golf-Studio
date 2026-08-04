import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: './',
    plugins: [react()],
    // Do not inherit unrelated PostCSS/Tailwind configs from parent folders.
    css: {
        postcss: { plugins: [] },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
