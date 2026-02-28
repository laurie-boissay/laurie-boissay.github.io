/* ==============================================================================
menu-builder.sync.js — UI (sync cible kcal/jour)
==============================================================================
Rôle
- Synchroniser le champ #calorieTargetDay avec :
  • event "calorieTargetUpdated"
  • window.calorieTargetKcal
  • localStorage (plusieurs clés historiques)
  • lecture opportuniste DOM (si include injecté tard)

Contrat
- Ne modifie pas les autres champs UI.
============================================================================== */

"use strict";

(function attachMenuBuilderSync(global) {
  const MB = global.MenuBuilder;

  MB.setupCalorieTargetSync = function setupCalorieTargetSync() {
    const targetInput = MB.dom.calorieTargetDay || document.getElementById("calorieTargetDay");
    if (!targetInput) return;

    const applyValue = (kcal) => {
      const n = parseInt(kcal, 10);
      if (!Number.isFinite(n) || n <= 0) return false;
      targetInput.value = String(n);
      return true;
    };

    global.addEventListener("calorieTargetUpdated", (e) => {
      if (e?.detail?.kcal) applyValue(e.detail.kcal);
    });

    if (typeof global.calorieTargetKcal === "number") applyValue(global.calorieTargetKcal);

    const storageKeys = [
      "calorieTargetKcal",
      "calorie_target_kcal",
      "calorieTarget",
      "calorie_target",
      "kcalTarget",
      "kcal_target",
    ];
    for (const k of storageKeys) {
      try {
        const v = localStorage.getItem(k);
        if (v) applyValue(v);
      } catch (_) {}
    }

    const candidateSelectors = [
      "[data-calorie-target]",
      "#ct-target-kcal",
      "#calorieTarget",
      "#calorie-target",
      "#calorieTargetValue",
      "#calorie-target-value",
    ];

    const tryReadFromDom = () => {
      for (const sel of candidateSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;

        if ("value" in el && el.value) {
          if (applyValue(el.value)) return;
        }

        const dt = el.getAttribute?.("data-calorie-target");
        if (dt) {
          if (applyValue(dt)) return;
        }

        const txt = (el.textContent || "").trim();
        const m = txt.match(/(\d{3,4})/);
        if (m) {
          if (applyValue(m[1])) return;
        }
      }
    };

    tryReadFromDom();

    // Observation : utile si l’include est injecté tardivement.
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        tryReadFromDom();
      });
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
})(window);
