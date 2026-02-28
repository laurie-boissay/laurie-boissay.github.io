/* ==============================================================================
menu-engine.js — Moteur “métier” (sans DOM)
==============================================================================
Rôle
- Fournir des fonctions pures (ou quasi pures) pour :
  • construire les pools de recettes par type (recipe_group + types synthétiques)
  • calculer les kcal d’une journée
  • tirer des recettes sous plafond calorique
  • générer un menu hebdomadaire en respectant les slots verrouillés
  • fournir la liste canonique des types (source unique UI)

Contrats
- Aucune dépendance au DOM.
- Aucune dépendance à Bootstrap.
- Les fonctions n’accèdent pas à des variables globales : tout est injecté via arguments.
- Format menu :
  menu[day][meal] = { slots: [ { type, recipe, locked } ] }

Notes d’architecture
- "Plat", "Snack" et "Final" sont des types synthétiques (agrégations de recipe_group).
- Petit déjeuner : Plat + Final + Boissons
- Déjeuner / Dîner : Plat + Final
- Collation / Goûter : Boissons + Snack
============================================================================== */

"use strict";

(function attachMenuEngine(global) {
  // ---------------------------------------------------------------------------
  // Source unique des types (UI)
  // ---------------------------------------------------------------------------

  /**
   * Liste CANONIQUE des types affichables.
   * - Inclut les recipe_group officiels utiles au menu-builder.
   * - Inclut les types synthétiques (Plat/Snack/Final).
   *
   * Contrat :
   * - `value` correspond aux clés utilisées dans `pools` et aux `slot.type`.
   * - `label` est l’étiquette UI.
   */
  const SLOT_TYPES = Object.freeze([
    // Groupes “réels” (recipe_group)
    { value: "Légumes & accompagnements", label: "Accompagnement" },
    { value: "Amuse-bouche", label: "Amuse-bouche" },
    { value: "Barres nutritionnelles", label: "Barre nutritionnelle" },
    { value: "Boissons", label: "Boisson" },
    { value: "Cake", label: "Cake" },
    { value: "Chocolat", label: "Chocolat" },
    { value: "Desserts & crèmes", label: "Dessert" },
    { value: "Fromages", label: "Fromage" },
    { value: "Fruits à coque", label: "Fruits à coque" },
    { value: "Fruits frais", label: "Fruits frais" },
    { value: "Gâteaux & biscuits", label: "Gâteaux & biscuits" },
    { value: "Graines", label: "Graines" },
    { value: "Œufs", label: "Œufs" },
    { value: "Pains & substituts", label: "Pains & substituts" },
    { value: "Pâtés", label: "Pâtés" },
    { value: "Poissons", label: "Poissons" },
    { value: "Sauces & assaisonnements", label: "Sauces & assaisonnements" },
    { value: "Soupe", label: "Soupe" },
    { value: "Viandes", label: "Viandes" },
    { value: "Yaourts", label: "Yaourts" },

    // Types synthétiques
    { value: "Plat", label: "Plat (au hasard)" },
    { value: "Snack", label: "Snack (au hasard)" },
    { value: "Final", label: "Final (au hasard)" },
  ]);

  /**
   * API publique : retourne une copie défensive de la liste canonique.
   * @returns {Array<{value:string,label:string}>}
   */
  function getSlotTypes() {
    return SLOT_TYPES.map((t) => ({ value: t.value, label: t.label }));
  }

  // ---------------------------------------------------------------------------
  // Types synthétiques (agrégation de groupes)
  // ---------------------------------------------------------------------------

  const AGG_PLAT_KEY = "Plat";
  const AGG_PLAT_GROUPS = [
    "Plats à base de viande",
    "Plats à base de poissons",
    "Plats à base de fruits de mer",
    "Plats à base d’œufs",
    "Plats à base de fromages",
  ];

  const AGG_SNACK_KEY = "Snack";
  const AGG_SNACK_GROUPS = ["Pains & substituts", "Yaourts", "Fruits à coque"];

  const AGG_FINAL_KEY = "Final";
  const AGG_FINAL_GROUPS = ["Gâteaux & biscuits", "Desserts & crèmes", "Yaourts", "Fruits frais", "Fruits à coque"];

  /**
   * Normalise une valeur “kcal” (entier ≥ 0).
   * @param {any} recipe
   * @returns {number}
   */
  function getRecipeCalories(recipe) {
    const kcal = parseInt(recipe?.calories ?? 0, 10);
    return Number.isFinite(kcal) && kcal > 0 ? kcal : 0;
  }

  /**
   * Calcule le total kcal d’un jour.
   * @param {Array} menuRef
   * @param {number} dayIndex
   * @returns {number}
   */
  function getDayCaloriesFromMenu(menuRef, dayIndex) {
    const day = menuRef?.[dayIndex];
    if (!Array.isArray(day)) return 0;

    let total = 0;
    for (const meal of day) {
      const slots = Array.isArray(meal?.slots) ? meal.slots : [];
      for (const s of slots) total += getRecipeCalories(s?.recipe);
    }
    return total;
  }

  /**
   * Construit un index complet recipe_group -> recettes.
   * @param {Array} recipes
   * @returns {Record<string, Array>}
   */
  function buildGroupIndex(recipes) {
    const index = {};
    for (const r of Array.isArray(recipes) ? recipes : []) {
      const g = String(r?.recipe_group || "").trim();
      if (!g) continue;
      if (!index[g]) index[g] = [];
      index[g].push(r);
    }
    return index;
  }

  /**
   * Construit un pool agrégé = concat des pools des groupes fournis.
   * @param {Record<string, Array>} groupIndex
   * @param {string[]} groups
   * @returns {Array}
   */
  function buildAggregatePoolFromIndex(groupIndex, groups) {
    const agg = [];
    for (const g of groups) {
      const pool = groupIndex[g] || [];
      if (pool.length > 0) agg.push(...pool);
    }
    return agg;
  }

  /**
   * Construit les pools de recettes par type.
   * - Types “réels” : recipe_group.
   * - Types synthétiques : unions de recipe_group.
   *
   * Contrat :
   * - Si `slotTypesOverride` est fourni, il remplace la liste canonique.
   * - Sinon, la liste canonique (SLOT_TYPES) est utilisée.
   *
   * @param {Array} recipes
   * @param {Array<{value:string,label:string}>=} slotTypesOverride
   * @returns {Record<string, Array>}
   */
  function buildPools(recipes, slotTypesOverride) {
    const slotTypes = Array.isArray(slotTypesOverride) && slotTypesOverride.length > 0 ? slotTypesOverride : SLOT_TYPES;

    const pools = {};
    for (const t of slotTypes) pools[t.value] = [];

    const groupIndex = buildGroupIndex(recipes);

    // Pools “réels” : uniquement si la clé existe dans slotTypes.
    for (const key of Object.keys(pools)) {
      if (key === AGG_PLAT_KEY || key === AGG_SNACK_KEY || key === AGG_FINAL_KEY) continue;
      pools[key] = groupIndex[key] ? [...groupIndex[key]] : [];
    }

    // Pools synthétiques.
    if (Object.prototype.hasOwnProperty.call(pools, AGG_PLAT_KEY)) {
      pools[AGG_PLAT_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_PLAT_GROUPS);
    }
    if (Object.prototype.hasOwnProperty.call(pools, AGG_SNACK_KEY)) {
      pools[AGG_SNACK_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_SNACK_GROUPS);
    }
    if (Object.prototype.hasOwnProperty.call(pools, AGG_FINAL_KEY)) {
      pools[AGG_FINAL_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_FINAL_GROUPS);
    }

    return pools;
  }

  /**
   * Indique si un repas est une collation/goûter selon le nombre de repas/jour.
   * @param {number} mealsPerDay
   * @param {number} mealIndex
   * @returns {boolean}
   */
  function isSnackMeal(mealsPerDay, mealIndex) {
    if (mealsPerDay === 4) return mealIndex === 2;
    if (mealsPerDay === 5) return mealIndex === 1 || mealIndex === 3;
    return false;
  }

  /**
   * Indique si le repas est le petit déjeuner (quand mealsPerDay >= 3).
   * @param {number} mealsPerDay
   * @param {number} mealIndex
   * @returns {boolean}
   */
  function isBreakfastMeal(mealsPerDay, mealIndex) {
    return mealsPerDay >= 3 && mealIndex === 0;
  }

  /**
   * Remplace les types absents de pools par des alternatives existantes.
   * @param {Record<string, Array>} pools
   * @param {string[]} wanted
   * @returns {string[]}
   */
  function normalizeTypesAgainstPools(pools, wanted) {
    const keys = Object.keys(pools || {});
    const fallback0 = keys[0] || "";
    const fallback1 = keys[1] || fallback0;
    return wanted.map((t, idx) => (keys.includes(t) ? t : idx === 0 ? fallback0 : fallback1));
  }

  /**
   * Retourne une liste ordonnée de types par défaut pour un repas.
   * @param {Record<string, Array>} pools
   * @param {number} mealsPerDay
   * @param {number} mealIndex
   * @returns {string[]}
   */
  function getDefaultSlotTypeListForMeal(pools, mealsPerDay, mealIndex) {
    if (isSnackMeal(mealsPerDay, mealIndex)) {
      return normalizeTypesAgainstPools(pools, ["Boissons", AGG_SNACK_KEY]);
    }

    if (isBreakfastMeal(mealsPerDay, mealIndex)) {
      return normalizeTypesAgainstPools(pools, [AGG_PLAT_KEY, AGG_FINAL_KEY, "Boissons"]);
    }

    return normalizeTypesAgainstPools(pools, [AGG_PLAT_KEY, AGG_FINAL_KEY]);
  }

  /**
   * Tire une recette aléatoire dans un pool sous contrainte maxKcal.
   * @param {Record<string, Array>} pools
   * @param {string} type
   * @param {number} maxKcal
   * @returns {any|null}
   */
  function pickRecipeWithCalorieLimit(pools, type, maxKcal) {
    const pool = pools?.[String(type || "")] || [];
    if (pool.length === 0) return null;

    if (!Number.isFinite(maxKcal) || maxKcal <= 0 || maxKcal === Infinity) {
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const filtered = pool.filter((r) => getRecipeCalories(r) <= maxKcal);
    if (filtered.length === 0) return null;

    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  /**
   * Retourne les types ajoutables pour un jour, sous plafond calorique.
   * @param {Array} menu
   * @param {Record<string, Array>} pools
   * @param {number} dayIndex
   * @param {number} calorieMax
   * @param {Array<{value:string,label:string}>} addSlotTypes
   * @returns {Array<{value:string,label:string}>}
   */
  function getAddableTypesForDay(menu, pools, dayIndex, calorieMax, addSlotTypes) {
    const used = getDayCaloriesFromMenu(menu, dayIndex);

    if (!Number.isFinite(calorieMax) || calorieMax <= 0) {
      return addSlotTypes.filter((t) => (pools[t.value] || []).length > 0);
    }

    const remaining = calorieMax - used;
    if (remaining <= 0) return [];

    return addSlotTypes.filter((t) => {
      const pool = pools[t.value] || [];
      if (pool.length === 0) return false;
      return pool.some((r) => getRecipeCalories(r) <= remaining);
    });
  }

  /**
   * Génère un squelette complet (7 jours) avec slots par défaut selon le repas.
   * @param {Record<string, Array>} pools
   * @param {number} mealsPerDay
   * @returns {Array}
   */
  function createFreshSkeleton(pools, mealsPerDay) {
    const out = [];

    for (let d = 0; d < 7; d++) {
      const dayMeals = [];
      for (let m = 0; m < mealsPerDay; m++) {
        const types = getDefaultSlotTypeListForMeal(pools, mealsPerDay, m);

        dayMeals.push({
          slots: types.map((type) => ({
            type,
            recipe: pickRecipeWithCalorieLimit(pools, type, Infinity),
            locked: false,
          })),
        });
      }
      out.push(dayMeals);
    }

    return out;
  }

  /**
   * Construit un menu sous plafond (si défini), en respectant :
   * - slots verrouillés (conservés)
   * - types des slots existants
   * - tirage sous contrainte kcal restante
   *
   * @param {Record<string, Array>} pools
   * @param {Array} prevMenu
   * @param {number} mealsPerDay
   * @param {number} calorieMax
   * @returns {Array}
   */
  function buildMenuUnderCalorieMax(pools, prevMenu, mealsPerDay, calorieMax) {
    const out = [];

    for (let d = 0; d < 7; d++) {
      const prevDay = prevMenu?.[d] || [];
      const newDay = [];

      for (let m = 0; m < mealsPerDay; m++) {
        const prevMeal = prevDay[m];
        const prevSlots = Array.isArray(prevMeal?.slots) ? prevMeal.slots : null;

        const defaultTypes = getDefaultSlotTypeListForMeal(pools, mealsPerDay, m);

        const baseSlots =
          prevSlots && prevSlots.length > 0
            ? prevSlots
            : defaultTypes.map((type) => ({ type, recipe: null, locked: false }));

        const newSlots = [];

        for (let i = 0; i < baseSlots.length; i++) {
          const s = baseSlots[i];
          const fallbackType = defaultTypes[i] || defaultTypes[0] || "";
          const type = String(s?.type || fallbackType);
          const locked = !!s?.locked;

          if (locked) {
            newSlots.push({ type, recipe: s?.recipe ?? null, locked: true });
            continue;
          }

          const tmpDayMeals = [...newDay, { slots: newSlots }];
          const usedSoFar = getDayCaloriesFromMenu([tmpDayMeals], 0);

          let remaining = Infinity;
          if (Number.isFinite(calorieMax) && calorieMax > 0) remaining = calorieMax - usedSoFar;

          const picked = pickRecipeWithCalorieLimit(pools, type, remaining);
          newSlots.push({ type, recipe: picked, locked: false });
        }

        newDay.push({ slots: newSlots });
      }

      out.push(newDay);
    }

    return out;
  }

  /**
   * Analyse un menu (dépassements, slots vides) au regard du plafond.
   * @param {Array} menu
   * @param {number} calorieMax
   * @returns {{max:number, overs:Array<{dayIndex:number,total:number}>, empties:number}}
   */
  function computeCalorieStatus(menu, calorieMax) {
    const status = { max: calorieMax, overs: [], empties: 0 };

    for (let d = 0; d < 7; d++) {
      const total = getDayCaloriesFromMenu(menu, d);
      if (Number.isFinite(calorieMax) && calorieMax > 0 && total > calorieMax) {
        status.overs.push({ dayIndex: d, total });
      }

      const day = menu?.[d] || [];
      for (const meal of day) {
        const slots = Array.isArray(meal?.slots) ? meal.slots : [];
        for (const s of slots) if (!s?.recipe) status.empties += 1;
      }
    }

    return status;
  }

  global.MenuEngine = Object.freeze({
    // Source unique des types
    getSlotTypes,

    // API métier
    getRecipeCalories,
    getDayCaloriesFromMenu,
    buildPools,
    pickRecipeWithCalorieLimit,
    getAddableTypesForDay,
    createFreshSkeleton,
    buildMenuUnderCalorieMax,
    computeCalorieStatus,
  });
})(window);
