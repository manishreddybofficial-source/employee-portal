/// <reference types="vitest/config" />
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import { validateEnv } from './src/config/validate-env';

const rootDir = dirname(fileURLToPath(import.meta.url));

/** HTML entry points. Each name is also its public URL (/employee -> employee.html). */
const pages = ['index', 'employee', 'attendance', 'leave-request', 'office-details', 'admin'];

/** Serves clean URLs in dev and preview, matching "cleanUrls" in vercel.json. */
function cleanUrls(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const [path = '/', query] = (req.url ?? '/').split('?');
    const page = path.slice(1);
    if (page !== 'index' && pages.includes(page)) {
      req.url = `/${page}.html${query ? `?${query}` : ''}`;
    }
    next();
  };

  return {
    name: 'clean-urls',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') validateEnv(loadEnv(mode, rootDir, 'VITE_'));
  return {
    plugins: [cleanUrls()],
    build: {
      rollupOptions: {
        input: Object.fromEntries(pages.map((page) => [page, resolve(rootDir, `${page}.html`)])),
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
