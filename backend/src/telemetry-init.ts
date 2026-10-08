import * as appInsights from 'applicationinsights';

// Application Insights must start before any other module is loaded: the
// HTTP/Express instrumentation only covers modules required after it (with the
// setup inside bootstrap(), Express was already loaded and no request was ever
// collected). Imported first in main.ts. Without the connection string (local,
// tests) it does nothing (OBS-01, VAL-04).
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights.setup().start();
}
