/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

import { provideExternalFederationRuntime } from "./provideFederationRuntime";

// Tiny entry bundled to public/federation-runtime.js and loaded from index.html
// before preload.js injects remoteEntry scripts.
provideExternalFederationRuntime();
