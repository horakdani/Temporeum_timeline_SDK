// A SvelteKit 3 a konfigurációt a Vite-pluginban kapja (svelte.config.js már
// nincs). A Node-szerver (adapter-node) kimenetét a G-SSR indítja: build/.
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });
