# Equipment from photos, names, or product links

Open Equipment Library → My custom parts → Find equipment with AI. Sign in, take/upload a photo or enter a name/link, review measurements and the parametric preview, save a named custom part, and choose a gym to use it in. A placed copy keeps its own settings even if the library part changes later.

## Local testing

Run the frontend with `npm run dev` and the separate Desktop `gym-studio-backend` with `npm run dev`. All `/api` traffic uses the backend on port 8788; a second AI Worker is no longer needed for Studio.

Without a provider key, local development selects **demo mode**. The UI explains that this mode does not analyze image content. Photo-only input uses the equipment type chosen in the form and returns clearly estimated example values. Measurements can be corrected, saved and placed just like real provider results. Production rejects this demo provider.

To use actual photo recognition, configure OPENROUTER_API_KEY or ANTHROPIC_API_KEY in the backend's `.env` and restart. Leave AI_PROVIDER blank to choose a configured key automatically; AI_MODEL can select a different compatible vision/tool model. Provider keys are server-only. Signed-in accounts require no separate AI access key.

## Research and geometry

The provider reads the image or product details, researches manufacturer specs and manuals, and submits a strict `PartSpec`. Photo inputs now request a generated component model by default: up to 24 coloured boxes, cylinders, ellipsoids and hollow tubes, with positions, sizes and rotations inferred from the visible structure. One universal renderer handles these assemblies; no product-specific template is required. Component geometry is validated numeric data, never executable AI code. The whole assembly scales to its reviewed overall measurements. The review lets users edit each component's shape, colour, size, position and rotation before saving. Published, estimated and user-corrected measurements are distinguished; confidence describes dimensions, not exact visual fidelity.

A single photo cannot establish exact physical scale, hidden geometry or an exact scanned mesh. Generated models are simplified editable reconstructions, without photorealistic textures or guaranteed hidden structure. Stock bench, machine, storage, cardio, block, disc and bed templates remain available for manual/product lookups. A generated assembly stores its components within the normal numeric part parameters so worker geometry, thumbnails, custom library, gym placement, exports and cloud saving use the existing pipeline. Users must review estimates and provide missing measurements. Not-found results remain explicit and support manual correction.

Saved equipment stores its name, parameters, product identity, sources, measurement provenance and confidence. Editing the equipment preserves provenance. Placed copies show the saved name in the builder and retain settings through history, export and reload.

Photos are resized in the browser and sent to the configured provider only for analysis. They are not saved as originals in the account database. Durable PostgreSQL cache applies to text/link research; photo lookups are not cached. Cached results do not consume lookup quota and remain available after the daily limit is reached. Request slots are atomically limited per account and globally, failed requests refund slots, and active provider requests are bounded.

## Optional full catalog requests

The existing catalog workflow remains available only when GITHUB_TOKEN and GITHUB_REPO are configured on the backend. Clicking Request full catalog part creates an external GitHub issue with the selected product's research; it is optional and disabled by default.

## Checks

Backend tests cover validation, provider image payloads, missing keys/provider errors, durable quotas, account/CSRF checks, complete saved gym/equipment flow and Nest routing. Frontend/model tests cover safe AI specifications, template envelopes, user overrides, provenance and placed-part restoration.

See [local testing and deployment](self-hosting.md) and the independent backend README for startup, real provider settings, SMTP and Coolify.
