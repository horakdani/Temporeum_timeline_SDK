import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

import { App } from "./app/app";

// A failed bootstrap is an unhandled rejection: the page reports it.
void bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] });
