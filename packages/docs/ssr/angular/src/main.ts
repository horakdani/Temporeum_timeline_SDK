import { bootstrapApplication } from "@angular/platform-browser";

import { App } from "./app/app";
import { appConfig } from "./app/app.config";

// A failed bootstrap is an unhandled rejection: the page reports it.
void bootstrapApplication(App, appConfig);
