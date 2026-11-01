export default {
  // A smoke a mi csomagjainkat méri, nem a Next lintjét vagy típusait.
  typescript: { ignoreBuildErrors: true },
  // A fixture a repón kívül épül; a Next ne keressen feljebb munkaterületet.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
};
