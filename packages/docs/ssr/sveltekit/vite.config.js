// SvelteKit 3 takes its config in the Vite plugin (there is no svelte.config.js
// any more). The Node server's (adapter-node) output is started by G-SSR: build/.
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });
