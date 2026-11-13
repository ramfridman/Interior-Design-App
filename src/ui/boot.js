/**
 * Runs before the app boots (loaded from index.html ahead of src/main.js): applies the saved theme so there is no
 * flash, and draws the real plan on the loading splash. Purely cosmetic — any failure leaves the plain splash.
 */
import { PLAN } from '../core/plan.js';
import { applyTheme } from './prefs.js';
import { planSvg } from './plan-svg.js';

try {
  applyTheme();
  const host = document.getElementById('boot-plan');
  if (host && !host.firstChild) host.append(planSvg(PLAN, { pad: 60 }));
} catch (err) { /* the splash still shows its status text */ }
