import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
	if (command === "serve") {
		return {
			root: "client",
			server: {
				port: 5173
			}
		};
	}

	// Library-like build used by scripts/ghpages.sh: client/dist/bundle.js exporting init()
	if (mode === "bundle") {
		return {
			publicDir: false,
			build: {
				outDir: "client/dist",
				emptyOutDir: true,
				minify: false,

				rollupOptions: {
					input: "client/src/index.ts",
					preserveEntrySignatures: "strict",

					output: {
						entryFileNames: "bundle.js",
						format: "es",
						assetFileNames: "[name][extname]"
					}
				}
			}
		};
	}

	return {
		root: "client",

		build: {
			outDir: "dist",
			emptyOutDir: true,

			rollupOptions: {
				input: "index.html"
			}
		}
	};
});
