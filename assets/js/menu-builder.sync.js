/* ==============================================================================
menu-builder.sync.js — UI (synchronisations : kcal + protéines)
==============================================================================
Rôle
- Synchroniser le champ #calorieTargetDay avec :
  • event "calorieTargetUpdated"
  • window.calorieTargetKcal
  • localStorage (plusieurs clés historiques)
  • lecture opportuniste DOM (si include injecté tard)

- Protéines :
  • #weightKg (poids) persistant
  • #proteinTargetDay (optionnel) :
      - si vide : validation désactivée
      - si poids présent et champ non override : auto = 2 g/kg
      - l’utilisateur peut override (persistant)
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
  // Protéines : poids + cible/jour (2 g/kg par défaut, override possible)
  // ---------------------------------------------------------------------------

  MB.setupProteinTargetSync = function setupProteinTargetSync() {
    const elWeight = MB.dom.weightKg || document.getElementById("weightKg");
    const elTarget = MB.dom.proteinTargetDay || document.getElementById("proteinTargetDay");
    if (!elWeight || !elTarget) return;

    const readNumber = (el) => {
      const raw = String(el.value || "").trim().replace(",", ".");
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

    const computeTarget = (weightKg) => {
      // Convention UI : 2 g/kg/jour, arrondi à l’unité.
      return Math.max(0, Math.round(2 * weightKg));
    };

    const isUserOverride = () => elTarget.dataset.userOverride === "1";

    const setUserOverride = (on) => {
      if (on) elTarget.dataset.userOverride = "1";
      else delete elTarget.dataset.userOverride;
    };

    const applyAutoIfAllowed = () => {
      const w = readNumber(elWeight);
      if (w === null) return;

      const auto = computeTarget(w);
      const hasTyped = String(elTarget.value || "").trim().length > 0;

      // Auto si :
      // - champ vide
      // - ou pas d’override utilisateur
      if (!hasTyped || !isUserOverride()) {
        elTarget.value = String(auto);
        setUserOverride(false);
      }
    };

    // 1) Restore localStorage
    try {
      const w = localStorage.getItem("weightKg");
      if (w) {
        const n = parseFloat(String(w).replace(",", "."));
        if (Number.isFinite(n) && n > 0) elWeight.value = String(round1(n));
      }

      const p = localStorage.getItem("proteinTargetDay");
      if (p !== null) {
        const trimmed = String(p).trim();
        if (trimmed === "") {
          // vide => validation désactivée
          elTarget.value = "";
          setUserOverride(false);
        } else {
          const n = parseFloat(trimmed.replace(",", "."));
          if (Number.isFinite(n) && n >= 0) {
            elTarget.value = String(Math.round(n));
            setUserOverride(true);
          }
        }
      }
    } catch (_) {}

    // 2) Si aucune valeur cible stockée : auto 2 g/kg si poids présent
    if (String(elTarget.value || "").trim() === "") applyAutoIfAllowed();

    // 3) Events
    elWeight.addEventListener("input", () => {
      applyAutoIfAllowed();
      try {
        localStorage.setItem("weightKg", String(elWeight.value || ""));
      } catch (_) {}
      MB.rerender?.();
    });

    elTarget.addEventListener("input", () => {
      const v = String(elTarget.value || "").trim();

      if (v === "") {
        // Champ vide => validation désactivée ; pas d’override.
        setUserOverride(false);
      } else {
        setUserOverride(true);
      }

      try {
        localStorage.setItem("proteinTargetDay", String(elTarget.value || ""));
      } catch (_) {}

      MB.rerender?.();
    });
  };
})(window);
