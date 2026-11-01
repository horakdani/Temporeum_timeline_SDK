import { provideZonelessChangeDetection } from "@angular/core";
import type { ApplicationConfig } from "@angular/core";
import { provideClientHydration } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideRouter([]), provideClientHydration()],
};
