import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app bundle so
        // a first visit does not pay for the chart library before it is used.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          motion: ["framer-motion"],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  plugins: [react()],
  server: {
    // In local dev, proxy API calls to the Express server
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
