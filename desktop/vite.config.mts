import { defineConfig } from 'vite';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { expandTemplate } = require('./scripts/renderer-templates.cjs') as {
  expandTemplate: (html: string, root: string) => string;
};

function rendererTemplates(root: string) {
  return {
    name: 'renderer-business-templates',
    transformIndexHtml(html: string) {
      return expandTemplate(html, root);
    },
  };
}

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  plugins: [rendererTemplates(path.resolve(import.meta.dirname, 'src/renderer'))],
  publicDir: path.resolve(import.meta.dirname, 'public'),
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'src/renderer/index.html'),
        popout: path.resolve(import.meta.dirname, 'src/renderer/popout.html'),
        'vision-test': path.resolve(import.meta.dirname, 'src/renderer/vision-test.html'),
        'workflow-test': path.resolve(import.meta.dirname, 'src/renderer/workflow-test.html'),
        'live-view': path.resolve(import.meta.dirname, 'src/renderer/live-view.html'),
        canvas: path.resolve(import.meta.dirname, 'src/renderer/canvas.html'),
        'canvas-benchmark': path.resolve(import.meta.dirname, 'src/renderer/canvas-benchmark.html'),
        'ui-showcase': path.resolve(import.meta.dirname, 'src/renderer/ui-showcase.html'),
        setup: path.resolve(import.meta.dirname, 'src/renderer/setup.html'),
      },
    },
  },
});
