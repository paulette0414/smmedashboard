import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: change "base" below to match your GitHub repo name
// e.g. if your repo is github.com/yourname/deped-romblon-dashboard
// then base should be '/deped-romblon-dashboard/'
export default defineConfig({
  base: '/deped-romblon-dashboard/',
  plugins: [react()],
})
