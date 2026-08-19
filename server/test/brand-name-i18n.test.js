'use strict';

/*
 * White-label substitution in user-facing strings (#292).
 *
 * A partner reselling this platform found their customers still being shown "ScreenTinker" in a
 * dozen places the White Label settings never reached — setup instructions, the empty-dashboard
 * hint, onboarding, sign-in errors. Their only workaround was CSS that could hide a section but
 * could not change a sentence.
 *
 * Those are translated strings, so the substitution belongs in the translation layer: they say
 * {brandName} and i18n.js fills it in at call time. Two things are worth pinning:
 *
 *   1. the strings really do carry the placeholder, in EVERY locale — a translator copying an
 *      English sentence back in is exactly how this regresses, silently, for one language;
 *   2. the placeholder actually resolves, and defaults to the product's own name so that an
 *      un-branded install reads exactly as it did before.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const I18N_DIR = path.join(__dirname, '..', '..', 'frontend', 'js', 'i18n');

/* The keys the issue enumerated: every user-facing string that named the product. */
const BRANDED_KEYS = [
  'auth.sso_err_domain_not_allowed',
  'dashboard.no_displays_desc',
  'device.owner_provision.constraints',
  'device.terminal.welcome',
  'settings.signin_err_link_already_used',
  'settings.hide_branding',
  'settings.setup_step_1',
  'settings.import.invalid_file',
  'onboarding.step.welcome.title',
];

const localeFiles = () => fs.readdirSync(I18N_DIR).filter((f) => f.endsWith('.js'));

test('no locale hardcodes the product name in a white-labelled string', () => {
  const offences = [];
  for (const file of localeFiles()) {
    const src = fs.readFileSync(path.join(I18N_DIR, file), 'utf8');
    for (const line of src.split('\n')) {
      if (!line.includes('ScreenTinker')) continue;
      if (BRANDED_KEYS.some((k) => line.includes(`'${k}'`) || line.includes(`"${k}"`))) {
        offences.push(`${file}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offences, [],
    'these strings must say {brandName}, or a reseller\'s customers see the upstream product name');
});

test('the English strings carry the placeholder rather than having simply lost the name', () => {
  // Guards the lazy fix: deleting "ScreenTinker" would satisfy the test above and leave a sentence
  // reading "Install the app on your TV", with nothing identifying what to install.
  const src = fs.readFileSync(path.join(I18N_DIR, 'en.js'), 'utf8');
  for (const key of BRANDED_KEYS) {
    const line = src.split('\n').find((l) => l.includes(`'${key}'`));
    assert.ok(line, `${key} is missing from en.js entirely`);
    assert.ok(line.includes('{brandName}'), `${key} should interpolate {brandName}: ${line.trim()}`);
  }
});

test('every translation of those keys keeps the placeholder', () => {
  // A translated string that drops {brandName} does not fail loudly — it just renders a sentence
  // with a hole in it, in one language, for the customers of one reseller.
  const missing = [];
  for (const file of localeFiles()) {
    if (file === 'en.js') continue;
    const src = fs.readFileSync(path.join(I18N_DIR, file), 'utf8');
    for (const key of BRANDED_KEYS) {
      const line = src.split('\n').find((l) => l.includes(`'${key}'`));
      if (!line) continue;                       // locale has not translated this key yet
      if (!line.includes('{brandName}')) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], 'translated strings dropped the {brandName} placeholder');
});

test('the interpolation resolves, and falls back to the product name', async () => {
  // i18n.js reads window.__ST_BRAND_NAME at CALL time, so branding.js can refresh it after first
  // paint and a workspace switch shows the new brand rather than the one cached at module load.
  const mod = path.join(I18N_DIR, '..', 'i18n.js');
  // i18n.js reads the saved language from localStorage as it loads, so both browser globals have to
  // exist before the import — not because this test cares about storage, but because the module
  // would throw on the way in.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = { __ST_BRAND_NAME: undefined, localStorage: globalThis.localStorage };
  const { t } = await import(`file://${mod}`);

  const unbranded = t('settings.setup_step_1');
  assert.ok(unbranded.includes('ScreenTinker'),
    `an un-branded install must read as before, got: ${unbranded}`);
  assert.ok(!unbranded.includes('{brandName}'), 'the placeholder must not leak to the screen');

  globalThis.window.__ST_BRAND_NAME = 'BoldSignage';
  const branded = t('settings.setup_step_1');
  assert.ok(branded.includes('BoldSignage'), `expected the brand, got: ${branded}`);
  assert.ok(!branded.includes('ScreenTinker'), 'the upstream name must be gone once branded');

  // Whitespace-only is not a brand.
  globalThis.window.__ST_BRAND_NAME = '   ';
  assert.ok(t('settings.setup_step_1').includes('ScreenTinker'));
  delete globalThis.window;
  delete globalThis.localStorage;
});
