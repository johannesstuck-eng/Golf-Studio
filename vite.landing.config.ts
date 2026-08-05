import { defineConfig } from 'vite';

export default defineConfig({
    root: 'landing',
    build: {
        outDir: '../dist-landing',
        emptyOutDir: true,
    },
});
