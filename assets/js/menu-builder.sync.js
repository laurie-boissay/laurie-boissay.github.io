/* ==============================================================================
menu-builder.sync.js — UI (synchronisations : kcal + protéines)
==============================================================================
Rôle
- Synchroniser le champ #calorieTargetDay (inchangé).
- Protéines :
  • #weightKg (poids) persistant
  • #proteinTargetPerKg (g/kg/jour) persistant (défaut 2.0)
  • #proteinTargetDay (g/jour) calculé automatiquement = poids × g/kg
    - readonly : on évite l’ambiguïté “override en g/jour”.
    - si poids absent => champ vide => validation/jour désactivée.
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

  // ---------------------------------------------------------------------------
  // Protéines : poids + cible (g/kg/jour) -> cible (g/jour)
  // ---------------------------------------------------------------------------

  MB.setupProteinTargetSync = function setupProteinTargetSync() {
    const elWeight = MB.dom.weightKg || document.getElementById("weightKg");
    const elPerKg = MB.dom.proteinTargetPerKg || document.getElementById("proteinTargetPerKg");
    const elDay = MB.dom.proteinTargetDay || document.getElementById("proteinTargetDay");
    if (!elWeight || !elPerKg || !elDay) return;

    const readFloat = (el) => {
      const raw = String(el.value || "").trim().replace(",", ".");
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const readFloatAllowZero = (el) => {
      const raw = String(el.value || "").trim().replace(",", ".");
      if (raw === "") return null;
      const n = parseFloat(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

    const recompute = () => {
      const w = readFloat(elWeight);
      const perKg = readFloatAllowZero(elPerKg);

      // Si pas de poids valide => désactive la validation/jour
      if (w === null) {
        elDay.value = "";
        return;
      }

      // perKg vide => on retombe sur défaut 2.0
      const targetPerKg = perKg === null ? 2.0 : perKg;

      const g = Math.max(0, Math.round(w * targetPerKg));
      elDay.value = String(g);
    };

    // Restore localStorage
    try {
      const w = localStorage.getItem("weightKg");
      if (w) {
        const n = parseFloat(String(w).replace(",", "."));
        if (Number.isFinite(n) && n > 0) elWeight.value = String(round1(n));
      }

      const perKg = localStorage.getItem("proteinTargetPerKg");
      if (perKg !== null && String(perKg).trim() !== "") {
        const n = parseFloat(String(perKg).replace(",", "."));
        if (Number.isFinite(n) && n >= 0) elPerKg.value = String(round1(n));
      }
    } catch (_) {}

    // Initial compute
    recompute();

    // Events
    elWeight.addEventListener("input", () => {
      try {
        localStorage.setItem("weightKg", String(elWeight.value || ""));
      } catch (_) {}
      recompute();
      MB.rerender?.();
    });

    elPerKg.addEventListener("input", () => {
      try {
        localStorage.setItem("proteinTargetPerKg", String(elPerKg.value || ""));
      } catch (_) {}
      recompute();
      MB.rerender?.();
    });
  };
})(window);
