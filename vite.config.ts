import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two builds:
//  1. default  -> HTML pages (popup/editor/pdf) + module service worker
//  2. --mode content -> content.js as a self-contained classic IIFE,
//     because it is injected with chrome.scripting.executeScript({files}).
export default defineConfig(({ mode }) => {
  const root = resolve(import.meta.dirname, 'src');
  const common = {
    root,
    base: './',
    publicDir: resolve(import.meta.dirname, 'public'),
  };

  if (mode === 'content') {
    return {
      ...common,
      publicDir: false as const,
      build: {
        outDir: resolve(import.meta.dirname, 'dist'),
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: resolve(root, 'content.js'),
          formats: ['iife' as const],
          name: 'snipwiseContent',
          fileName: () => 'content.js',
        },
      },
    };
  }

  return {
    ...common,
    build: {
      outDir: resolve(import.meta.dirname, 'dist'),
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: 'es2022',
      rollupOptions: {
        input: {
          popup: resolve(root, 'popup.html'),
          editor: resolve(root, 'editor.html'),
          pdf: resolve(root, 'pdf.html'),
          background: resolve(root, 'background.js'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
