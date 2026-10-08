import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Preload the hashed Archivo file: otherwise the browser finds it only after the CSS is parsed and the text reflows late. */
function preloadDisplayFont(): Plugin {
  return {
    name: 'melodai-preload-display-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find(file => /archivo-wdth-latin[^/]*\.woff2$/.test(file))
        return font ? [{ tag: 'link', attrs: { rel: 'preload', href: `/${font}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' }] : []
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), preloadDisplayFont()],
  server: {
    port: 3000,
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:5000',
      '/songs': process.env.API_PROXY_TARGET || 'http://localhost:5000',
    },
  },
  build: {
    outDir: '../src/static',
    emptyOutDir: true,
  },
})
