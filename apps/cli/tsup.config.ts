import { defineConfig } from "tsup";

// Bundle the workspace packages into a single self-contained CLI; keep the
// heavy runtime libraries (ink/react/ollama/claude-agent-sdk/zod) as external
// npm dependencies of the published `brainstorming` package.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  noExternal: [/^@brainstorming\//],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  dts: false,
  minify: false,
});
