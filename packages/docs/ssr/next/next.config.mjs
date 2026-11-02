export default {
  // The smoke measures our packages, not Next's lint or types.
  typescript: { ignoreBuildErrors: true },
  // The fixture is built outside the repo; Next should not look further up for a workspace.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
};
