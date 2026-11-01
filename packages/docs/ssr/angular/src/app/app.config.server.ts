import { mergeApplicationConfig } from "@angular/core";
import type { ApplicationConfig } from "@angular/core";
import { provideServerRendering, RenderMode, withRoutes } from "@angular/ssr";

import { appConfig } from "./app.config";

// Every path rendered on the server, per request: the smoke asks for the server's HTML.
const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes([{ path: "**", renderMode: RenderMode.Server }]))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
