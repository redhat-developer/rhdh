# NFS `defaultLanguage` E2E coverage

Follow-up to the localization nightly fix ([#5797](https://github.com/redhat-developer/rhdh/pull/5797) /
RHDHBUGS-4094). That work seeds `localStorage.language` for non-English Playwright
projects. It does **not** cover a non-English `api:app/app-language.defaultLanguage`
when no language is stored.

## NFS language selection (reminder)

| Condition | App language |
| --- | --- |
| No stored language | `defaultLanguage`, then saved to `localStorage.language` on first load |
| Stored language in `availableLanguages` | Stored language |
| Stored language not in `availableLanguages` | `defaultLanguage` |
| Browser locale only | Ignored on NFS |

Sign-in heading (`plugin.app-auth.sign-in`) is English-only today; Guest Enter may
still localize. Do not assert translated sign-in titles until product ships them.

## Approach

### Local harness (implemented)

1. `app-config.local-e2e.yaml` sets
   `defaultLanguage: ${APP_DEFAULT_LANGUAGE:-en}` so the normal
   `yarn e2e:local` path stays English.
2. `playwright.local-default-language.config.ts` sets `APP_DEFAULT_LANGUAGE=fr`
   and `LOCALE=fr`, and always starts a fresh backend/frontend (no
   `reuseExistingServer`) so a previously started English harness is not reused.
3. `e2e/default-language.spec.ts` calls `signInAsGuest(..., { seedLanguage: false })`
   so the app must take French from `defaultLanguage`, not from a test seed.
4. Specs assert:
   - before sign-in: `localStorage.language` becomes `fr` after first load
   - after sign-in: home welcome, sidebar Catalog/Docs, Settings language = Français
   - Settings override (Deutsch) survives reload and sign-out/sign-in
   - stored `xx` falls back to `fr`

```bash
# requires dynamic-plugins-root (same as e2e:local)
yarn --cwd e2e-tests e2e:local:default-language
```

Existing `showcase-localization-*` projects and English smoke are unchanged.
`default-language.spec.ts` is listed in `playwright.config.ts` `testIgnore` for
showcase / operator / k8s / fips so Prow `e2e-ocp-helm` does not run it against
`defaultLanguage: en`.

### CI / localization nightly (not in this change)

`e2e-ocp-helm-localization-nightly` uses one Helm deploy with `defaultLanguage: en`
for all locale projects. Changing that default would affect every project on the
shared instance. A non-English default in CI needs a **separate** deployment or job
(for example a second ConfigMap overlay). Track that as a follow-up if product
wants nightly coverage of this path.

## Related docs

- [Customizing the Language dropdown](../customization.md#customizing-the-language-dropdown)
- [Local E2E harness](./local-e2e-harness.md)
- [CI localization tests](./CI.md#localization-tests)
