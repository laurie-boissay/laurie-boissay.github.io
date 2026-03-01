/* ==============================================================================
menu-pdf.js — Export du menu en PDF (jsPDF)
==============================================================================
Rôle
- Exporter le menu (jours → repas → recettes) en PDF lisible.
- Mettre en forme : bandeaux, sections, couleurs.
- Rendre les titres de recettes cliquables via des URL ABSOLUES (compat PDF).
- Générer une liste de courses agrégée à partir des ingrédients des recettes du menu.

Point clé (liens PDF)
- Beaucoup de lecteurs PDF ignorent les annotations dont l’URL est relative.
- On force donc systématiquement une URL absolue (https://…).

Dépendances
- jsPDF UMD : window.jspdf.jsPDF
- MenuBuilder + MenuEngine déjà chargés
============================================================================== */

"use strict";

(function attachMenuPdf(global) {
  // Garde-fou : évite double initialisation si script inclus deux fois.
  if (global.__menuPdfInitialized) return;
  global.__menuPdfInitialized = true;

  const BTN_ID = "exportMenuPdf";

  // ---------------------------------------------------------------------------
  // Helpers bas niveau
  // ---------------------------------------------------------------------------

  function getJsPdfCtor() {
    const ns = global.jspdf;
    if (!ns || typeof ns.jsPDF !== "function") return null;
    return ns.jsPDF;
  }

  function safeNum(x) {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function fmt1(n) {
    const x = Math.round((Number(n) || 0) * 10) / 10;
    return String(x).replace(".0", "");
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function buildPdfFileName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `menu_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
  }

  function ensureSpace(doc, cursor, neededMm) {
    const pageH = doc.internal.pageSize.getHeight();
    const bottom = pageH - 14;

    if (cursor.y + neededMm <= bottom) return cursor;

    doc.addPage();
    cursor.y = 18;
    return cursor;
  }

  function setText(doc, size, r, g, b, style) {
    doc.setFont("helvetica", style || "normal");
    doc.setFontSize(size);
    doc.setTextColor(r, g, b);
  }

  function drawBand(doc, x, y, w, h, r, g, b) {
    doc.setFillColor(r, g, b);
    doc.rect(x, y, w, h, "F");
  }

  function ellipsisToWidth(doc, text, maxWidth) {
    const s = String(text || "");
    if (doc.getTextWidth(s) <= maxWidth) return s;

    const ell = "…";
    let lo = 0;
    let hi = s.length;

    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = s.slice(0, mid) + ell;
      if (doc.getTextWidth(candidate) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }

    return s.slice(0, lo) + ell;
  }

  /**
   * Normalisation URL pour PDF :
   * - Utilise la normalisation du site (baseurl, relative_url, etc.).
   * - Force une URL absolue (sinon lien souvent non cliquable dans les lecteurs PDF).
   */
  function normalizeUrl(MB, url) {
    // 1) Normalisation “site”
    let u = "#";
    if (MB && typeof MB.normalizeRecipeUrl === "function") {
      u = MB.normalizeRecipeUrl(url);
    } else {
      u = String(url || "#").trim();
    }

    u = String(u || "#").trim();
    if (!u || u === "#") return "#";

    // 2) Déjà absolu
    if (/^https?:\/\//i.test(u)) return u;

    // 3) Cas protocole relatif //example.com/path
    if (u.startsWith("//")) return `https:${u}`;

    // 4) Absolutisation via l’origine courante (prod ou local)
    //    Note : en prod GitHub Pages, window.location.origin = https://laurie-boissay.github.io
    //    et MB.normalizeRecipeUrl renvoie typiquement /laurie-boissay/recettes/....
    if (u.startsWith("/")) return `${window.location.origin}${u}`;

    // 5) Dernier recours : construire sur l’URL de la page (pour les chemins relatifs sans /)
    try {
      return new URL(u, window.location.href).toString();
    } catch (_) {
      return u;
    }
  }

  // ---------------------------------------------------------------------------
  // Totaux
  // ---------------------------------------------------------------------------

  function sumMeal(mealObj, MenuEngine) {
    const slots = Array.isArray(mealObj?.slots) ? mealObj.slots : [];

    let kcal = 0;
    let netCarbs = 0;
    let fat = 0;
    let protein = 0;

    for (const s of slots) {
      kcal += safeNum(MenuEngine.getRecipeCalories(s?.recipe));
      netCarbs += safeNum(MenuEngine.getRecipeNetCarbs(s?.recipe));
      fat += safeNum(MenuEngine.getRecipeFat(s?.recipe));
      protein += safeNum(MenuEngine.getRecipeProtein(s?.recipe));
    }

    return { kcal, netCarbs, fat, protein, slots };
  }

  function getDayLabel(dayOffset, weekStart, daysArr) {
    const startIndex = weekStart === 0 ? 6 : weekStart - 1;
    const dayIndex = (startIndex + dayOffset) % 7;
    return daysArr[dayIndex] || `Jour ${dayOffset + 1}`;
  }

  // ---------------------------------------------------------------------------
  // Liste de courses (agrégation)
  // ---------------------------------------------------------------------------

  /**
   * Normalise une chaîne pour faire une clé d'agrégation stable.
   * Objectif : regrouper les ingrédients sans tenter de faire du NLP lourd.
   */
  function toKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function roundToStep(n, step) {
    const x = Number(n);
    const s = Number(step) || 1;
    if (!Number.isFinite(x)) return 0;
    return Math.round(x / s) * s;
  }

  function formatQty(qty, unit) {
    const u = String(unit || "").trim();
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) return "";

    // Règles de lisibilité : arrondis modestes, sans sur-précision.
    if (u === "g") return `${roundToStep(q, 5)} g`;
    if (u === "ml") return `${roundToStep(q, 10)} ml`;

    // Unités "compte" : éviter 3,333...
    if (u === "x") {
      const v = Math.round(q * 10) / 10;
      return `${String(v).replace(".0", "")} ×`;
    }

    // Unités textuelles (cuillères, etc.) : pas d'arrondi agressif.
    if (u === "c. à soupe" || u === "c. à café") {
      const v = Math.round(q * 10) / 10;
      return `${String(v).replace(".0", "")} ${u}`;
    }

    // Cas générique
    const v = Math.round(q * 100) / 100;
    return `${String(v).replace(".0", "")} ${u}`.trim();
  }

  /**
   * Normalise un ingrédient structuré (objet YAML) pour l'agrégation.
   * Contrat attendu :
   * - item (id stable) / label (affichage)
   * - qty (nombre) + unit (unité normalisée)
   * - group (optionnel, rayon)
   *
   * Retourne null si non exploitable.
   */
  function normalizeStructuredIngredient(obj) {
    if (!obj || typeof obj !== "object") return null;

    const label = String(obj.label || obj.item || "").trim();
    const item = String(obj.item || "").trim();
    const qty = Number(obj.qty);
    const unit = String(obj.unit || "x").trim();
    const group = obj.group ? String(obj.group).trim() : "";

    if (!label) return null;
    if (!Number.isFinite(qty) || qty <= 0) return null;

    // IMPORTANT : on agrège par item si présent, sinon par label.
    const aggKey = item ? toKey(item) : toKey(label);

    return {
      aggKey,
      name: label,
      qty,
      unit,
      group,
      raw: label,
    };
  }

  /**
   * Extrait un "(quantité, unité, nom)" depuis une ligne d'ingrédient (format legacy string).
   * Contrat :
   * - Supporte les formats simples : "800 g de skyr", "2 concombres moyens", "4 c. à soupe de vinaigre".
   * - Si parsing incertain : retourne { raw } pour garder l'information.
   */
  function parseIngredientLine(line) {
    const raw = String(line || "").trim();
    if (!raw) return null;

    // Split simple "Sel, poivre" → deux items.
    if (/[,;]/.test(raw) && !/\d/.test(raw)) {
      const parts = raw
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) return parts.map((p) => ({ qty: 1, unit: "x", name: p, raw: p }));
    }

    // "1/2" ou "1,5" ou "2".
    const num = "(?:\\d+(?:[.,]\\d+)?|\\d+\\/\\d+)";
    const re = new RegExp(
      `^\\s*(${num})\\s*(kg|g|gr|mg|l|L|ml|cl|c\\.?\\s*a\\.?\\s*soupe|c\\.?\\s*a\\.?\\s*cafe|cs|cac|cc|sachet(?:s)?|tranche(?:s)?|gousse(?:s)?|oeuf(?:s)?|œuf(?:s)?)?\\s*(?:de\\s+|d\\'|d\\u\\s+|d\\es\\s+)?(.+)$`,
      "i"
    );

    const m = raw.match(re);
    if (!m) return { raw };

    let qtyStr = m[1];
    const unitRaw = (m[2] || "").trim();
    let name = (m[3] || "").trim();

    // Quantité : fraction "1/2".
    let qty = 0;
    if (/\//.test(qtyStr)) {
      const [a, b] = qtyStr.split("/").map((x) => Number(String(x).replace(",", ".")));
      if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) qty = a / b;
    } else {
      qty = Number(qtyStr.replace(",", "."));
    }

    if (!Number.isFinite(qty) || qty <= 0) return { raw };

    // Normalisation unité.
    let unit = unitRaw.toLowerCase();
    unit = unit
      .replace(/\s+/g, " ")
      .replace(/^gr$/, "g")
      .replace(/^cs$/, "c. à soupe")
      .replace(/^(cac|cc)$/, "c. à café")
      .replace(/^oeufs?$/, "x")
      .replace(/^œufs?$/, "x")
      .replace(/^tranches?$/, "x")
      .replace(/^sachets?$/, "x")
      .replace(/^gousses?$/, "x");

    // Conversion g/ kg ; ml/ cl/ l (on agrège en g et ml pour limiter les cas).
    if (unit === "kg") {
      qty *= 1000;
      unit = "g";
    }
    if (unit === "mg") {
      qty /= 1000;
      unit = "g";
    }
    if (unit === "l" || unit === "L") {
      qty *= 1000;
      unit = "ml";
    }
    if (unit === "cl") {
      qty *= 10;
      unit = "ml";
    }

    // Nettoyage nom : enlever "de" résiduel, parenthèses et doubles espaces.
    name = name
      .replace(/^de\s+/i, "")
      .replace(/^d['’]\s*/i, "")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    /*
      Garde-fou (Option 1) : unité incohérente → bascule en "non agrégé".
      Exemple réel : "250 ml lapin entier découpé".
    */
    if (unit === "ml") {
      const probe = `${toKey(raw)} ${toKey(name)}`;
      if (
        /\b(lapin|poulet|dinde|porc|jambon|saucisse|steak|boeuf|viande|poisson|saumon|truite|thon|crevette|saint jacques|st jacques)\b/.test(
          probe
        )
      ) {
        return { raw };
      }
    }

    if (!name) return { raw };

    return { qty, unit: unit || "x", name, raw };
  }

  /**
   * Mapping simple "group" (ingrédients structurés) → libellé catégorie.
   * Si group est absent : fallback heuristique (regex) sur le nom.
   */
  function mapGroupToCategory(group) {
    const g = toKey(group);
    if (!g) return "";

    if (/\b(legumes|legume|légumes|légume)\b/.test(g)) return "Légumes";
    if (/\b(viandes|viande)\b/.test(g)) return "Viandes";
    if (/\b(poissons|poisson|fruits de mer|fruits-de-mer|fruit de mer|crevettes)\b/.test(g)) return "Poissons & fruits de mer";
    if (/\b(fromages|fromage|cremerie|crèmerie|lait|yaourt)\b/.test(g)) return "Crèmerie";
    if (/\b(epicerie|épicerie)\b/.test(g)) return "Épicerie";
    if (/\b(assaisonnements|assaisonnement|epices|épices)\b/.test(g)) return "Assaisonnements";
    if (/\b(graines|noix|fruits a coque|fruits-à-coque)\b/.test(g)) return "Graines & fruits à coque";

    return "";
  }

  function classifyIngredient(name, explicitGroup) {
    const fromGroup = mapGroupToCategory(explicitGroup);
    if (fromGroup) return fromGroup;

    const k = toKey(name);

    // Catégories volontairement grossières : on privilégie la lisibilité et la stabilité.
    if (/\b(sel|poivre|vinaigre|moutarde|epice|epices|curry|piment|herbe|sauce|soja)\b/.test(k))
      return "Assaisonnements";
    if (/\b(beurre|creme|cr[eè]me|fromage|yaourt|yogourt|skyr|lait|oeuf|œuf)\b/.test(k)) return "Crèmerie";
    if (/\b(poulet|boeuf|bœuf|porc|saucisse|jambon|steak|dinde)\b/.test(k)) return "Viandes";
    if (/\b(saumon|truite|thon|poisson|crevette|crevettes|saint-jacques|st jacques)\b/.test(k))
      return "Poissons & fruits de mer";
    if (
      /\b(concombre|salade|courgette|brocoli|chou|poireau|asperge|champignon|epinard|épinard|tomate|avocat|oignon|ail)\b/.test(k)
    )
      return "Légumes";
    if (/\b(amande|noix|noisette|chia|lin|psyllium|graines)\b/.test(k)) return "Graines & fruits à coque";
    return "Épicerie";
  }

  function collectShoppingList(menu) {
    // 1) Compter les occurrences de recettes (un slot = une portion)
    const usage = new Map();
    for (const dayMeals of menu) {
      if (!Array.isArray(dayMeals)) continue;
      for (const mealObj of dayMeals) {
        const slots = Array.isArray(mealObj?.slots) ? mealObj.slots : [];
        for (const s of slots) {
          const r = s?.recipe;
          if (!r) continue;

          const id = r.recipe_sort || r.url || r.title;
          if (!id) continue;

          const cur = usage.get(id) || { recipe: r, portions: 0 };
          cur.portions += 1;
          cur.recipe = r;
          usage.set(id, cur);
        }
      }
    }

    // 2) Agréger ingrédients (mise à l'échelle via servings si présent)
    const agg = new Map(); // key → { name, unit, qty, group? }
    const misc = []; // lignes non parsées (affichées dans un bloc séparé)

    for (const { recipe } of usage.values()) {
      // Règle actuelle :
      // - si une recette apparaît dans le menu, on prend les quantités telles qu’écrites
      //   (donc pour le servings de la recette)
      // - on ne multiplie pas même si la recette apparaît plusieurs fois
      const factor = 1;
const ing = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
      for (const line of ing) {
        // --- NOUVEAU FORMAT : ingrédient structuré (objet YAML) ----------------
        const structured = normalizeStructuredIngredient(line);
        if (structured) {
          const qty = safeNum(structured.qty) * factor;
          if (!Number.isFinite(qty) || qty <= 0) {
            misc.push(structured.name);
            continue;
          }

          const unit = String(structured.unit || "x").trim();
          const key = `${structured.aggKey}|${unit}`;

          const cur = agg.get(key) || { name: structured.name, unit, qty: 0, group: structured.group || "" };
          cur.qty += qty;

          // On conserve un group si présent (rayon) — utile pour le tri.
          if (!cur.group && structured.group) cur.group = structured.group;

          agg.set(key, cur);
          continue;
        }

        // --- FORMAT LEGACY : string -> parsing tolérant ------------------------
        const parsed = parseIngredientLine(line);
        if (!parsed) continue;

        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const it of items) {
          // Cas "non parsé" : on garde la ligne telle quelle + indicateur de recette.
          if (it.raw && !it.name) {
            const t = recipe?.title ? ` (${recipe.title})` : "";
            misc.push(`${String(it.raw)}${t}`);
            continue;
          }

          const name = String(it.name || it.raw || "").trim();
          if (!name) continue;

          const unit = String(it.unit || "x").trim();
          const qty = safeNum(it.qty) * factor;

          if (!Number.isFinite(qty) || qty <= 0) {
            misc.push(name);
            continue;
          }

          const key = `${toKey(name)}|${unit}`;
          const cur = agg.get(key) || { name, unit, qty: 0, group: "" };
          cur.qty += qty;
          agg.set(key, cur);
        }
      }
    }

    // 3) Grouper + trier pour rendu
    const grouped = new Map();
    for (const it of agg.values()) {
      const cat = classifyIngredient(it.name, it.group);
      const arr = grouped.get(cat) || [];
      arr.push(it);
      grouped.set(cat, arr);
    }

    for (const [cat, arr] of grouped.entries()) {
      arr.sort((a, b) => toKey(a.name).localeCompare(toKey(b.name), "fr"));
      grouped.set(cat, arr);
    }

    misc.sort((a, b) => toKey(a).localeCompare(toKey(b), "fr"));

    return { grouped, misc };
  }

  function renderShoppingList(doc, cursor, MB, menu, palette, pageW) {
    const X = 14;
    const W = pageW - 28;

    const { grouped, misc } = collectShoppingList(menu);
    const hasAny = grouped.size > 0 || misc.length > 0;
    if (!hasAny) return cursor;

    // Page dédiée : la liste de courses doit être facile à imprimer / utiliser.
    doc.addPage();
    cursor.y = 18;

    drawBand(doc, 0, 0, pageW, 18, palette.accent[0], palette.accent[1], palette.accent[2]);
    setText(doc, 16, 255, 255, 255, "bold");
    doc.text("Liste de courses", 14, 12);

    setText(doc, 9.5, 235, 242, 255, "normal");
    doc.text("(agrégée à partir des recettes du menu)", pageW - 14, 12, { align: "right" });

    // Avertissement : la liste de courses repose sur des heuristiques (parsing legacy, regroupements, arrondis).
    // Elle est signalée comme "travail en cours" pour éviter une confiance excessive.
    setText(doc, 9.5, palette.warn[0], palette.warn[1], palette.warn[2], "bold");
    doc.text("Liste de courses : travail en cours (peut contenir des imprécisions).", 14, 22);
    setText(doc, 9.5, palette.muted[0], palette.muted[1], palette.muted[2], "normal");
    doc.text("Vérifie surtout les unités/quantités et le bloc \"À vérifier (non agrégé)\".", 14, 27);

    cursor.y = 34;

    const order = [
      "Légumes",
      "Viandes",
      "Poissons & fruits de mer",
      "Crèmerie",
      "Graines & fruits à coque",
      "Épicerie",
      "Assaisonnements",
    ];

    const cats = order.filter((c) => grouped.has(c));
    for (const cat of cats) {
      const items = grouped.get(cat) || [];

      ensureSpace(doc, cursor, 12);
      setText(doc, 12, palette.ink[0], palette.ink[1], palette.ink[2], "bold");
      doc.text(cat, X, cursor.y);
      cursor.y += 6;

      for (const it of items) {
        ensureSpace(doc, cursor, 6);

        const qtyTxt = formatQty(it.qty, it.unit);
        const line = qtyTxt ? `${qtyTxt} ${it.name}` : it.name;

        setText(doc, 10, palette.ink[0], palette.ink[1], palette.ink[2], "normal");
        doc.text("•", X + 2, cursor.y);
        doc.text(ellipsisToWidth(doc, line, W - 10), X + 6, cursor.y);
        cursor.y += 5.5;
      }

      cursor.y += 2;
    }

    if (misc.length > 0) {
      ensureSpace(doc, cursor, 10);
      setText(doc, 12, palette.ink[0], palette.ink[1], palette.ink[2], "bold");
      doc.text("À vérifier (non agrégé)", X, cursor.y);
      cursor.y += 6;

      setText(doc, 10, palette.muted[0], palette.muted[1], palette.muted[2], "normal");
      for (const raw of misc) {
        ensureSpace(doc, cursor, 6);
        doc.text("•", X + 2, cursor.y);
        doc.text(ellipsisToWidth(doc, raw, W - 10), X + 6, cursor.y);
        cursor.y += 5.5;
      }
    }

    return cursor;
  }

  // ---------------------------------------------------------------------------
  // Rendu PDF
  // ---------------------------------------------------------------------------

  function exportMenuToPdf() {
    const MB = global.MenuBuilder;
    const MenuEngine = global.MenuEngine;

    if (!MB || !MenuEngine) return;

    const menu = MB.state?.menu;
    if (!Array.isArray(menu) || menu.length === 0) {
      MB.showMessage?.("Génère un menu avant d’exporter le PDF.", "secondary");
      return;
    }

    const JsPdf = getJsPdfCtor();
    if (!JsPdf) {
      MB.showMessage?.("Export PDF indisponible : jsPDF n’est pas chargé.", "danger");
      return;
    }

    const params = MB.readParams?.() || { weekStart: 1, mealsPerDay: 3, daysCount: 3 };
    const safeDaysCount = clamp(parseInt(params.daysCount, 10) || 3, 1, 7);

    const mealLabels =
      MB.MEAL_LABELS_BY_COUNT?.[params.mealsPerDay] ||
      MB.MEAL_LABELS_BY_COUNT?.[3] ||
      [];

    const doc = new JsPdf({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const cursor = { y: 18 };

    // Palette simple (RGB) : sobre, lisible, compatible impression.
    const C = {
      ink: [30, 30, 35],
      muted: [110, 110, 120],
      accent: [30, 90, 160],
      accent2: [20, 120, 90],
      dayBand: [30, 90, 160],
      mealBg: [245, 247, 250],
      cardBorder: [225, 230, 238],
      warn: [190, 110, 10],
    };

    // Bandeau titre
    drawBand(doc, 0, 0, pageW, 18, C.accent[0], C.accent[1], C.accent[2]);
    setText(doc, 16, 255, 255, 255, "bold");
    doc.text("Menu", 14, 12);

    setText(doc, 9.5, 235, 242, 255, "normal");
    doc.text(`Exporté le ${new Date().toLocaleDateString("fr-FR")}`, pageW - 14, 12, { align: "right" });

    // Marges
    const X = 14;
    const W = pageW - 28;

    // Intro / résumé paramètres (léger)
    setText(doc, 10.5, C.ink[0], C.ink[1], C.ink[2], "normal");
    doc.text(`${safeDaysCount} jour(s) · ${params.mealsPerDay} repas/jour`, X, cursor.y);
    cursor.y += 8;

    for (let dayOffset = 0; dayOffset < safeDaysCount; dayOffset += 1) {
      const dayMeals = menu[dayOffset];
      if (!Array.isArray(dayMeals)) continue;

      // Bandeau jour
      ensureSpace(doc, cursor, 18);
      drawBand(doc, X, cursor.y - 5, W, 10, C.dayBand[0], C.dayBand[1], C.dayBand[2]);
      setText(doc, 12, 255, 255, 255, "bold");
      doc.text(getDayLabel(dayOffset, params.weekStart, MB.DAYS), X + 3, cursor.y + 2);
      cursor.y += 11;

      let dayK = 0;
      let dayC = 0;
      let dayF = 0;
      let dayP = 0;

      for (let mealIndex = 0; mealIndex < dayMeals.length; mealIndex += 1) {
        const mealObj = dayMeals[mealIndex];
        const label = mealLabels[mealIndex] || `Repas ${mealIndex + 1}`;

        const totals = sumMeal(mealObj, MenuEngine);
        dayK += totals.kcal;
        dayC += totals.netCarbs;
        dayF += totals.fat;
        dayP += totals.protein;

        // Carte repas
        ensureSpace(doc, cursor, 14);
        doc.setDrawColor(C.cardBorder[0], C.cardBorder[1], C.cardBorder[2]);
        doc.setLineWidth(0.2);
        doc.setFillColor(C.mealBg[0], C.mealBg[1], C.mealBg[2]);
        doc.roundedRect(X, cursor.y - 2, W, 10, 2, 2, "FD");

        setText(doc, 10.5, C.ink[0], C.ink[1], C.ink[2], "bold");
        doc.text(label, X + 3, cursor.y + 4);

        // Totaux repas (à droite)
        setText(doc, 9.5, C.muted[0], C.muted[1], C.muted[2], "normal");
        doc.text(
          `P ${fmt1(totals.protein)} g · ${Math.round(totals.kcal)} kcal · G net ${fmt1(totals.netCarbs)} g`,
          X + W - 3,
          cursor.y + 4,
          { align: "right" }
        );

        cursor.y += 12;

        // Contenu repas : recettes
        if (!totals.slots || totals.slots.length === 0) {
          ensureSpace(doc, cursor, 6);
          setText(doc, 9.5, C.muted[0], C.muted[1], C.muted[2], "italic");
          doc.text("— Aucun slot —", X + 4, cursor.y);
          cursor.y += 6;
          continue;
        }

        for (const s of totals.slots) {
          const r = s?.recipe;
          const titleRaw = r?.title || "—";
          const urlRaw = r?.url || "#";
          const url = normalizeUrl(MB, urlRaw);

          const kcal = safeNum(MenuEngine.getRecipeCalories(r));
          const prot = safeNum(MenuEngine.getRecipeProtein(r));
          const carbs = safeNum(MenuEngine.getRecipeNetCarbs(r));

          // Ligne recette (1 ligne, titre tronqué)
          ensureSpace(doc, cursor, 6);

          const leftX = X + 6;
          const rightX = X + W - 3;

          // Bloc macros (droite) + bloc titre (gauche)
          setText(doc, 9.5, C.muted[0], C.muted[1], C.muted[2], "normal");
          const macros = `P ${fmt1(prot)} · ${Math.round(kcal)} kcal · G ${fmt1(carbs)}`;
          const macrosW = doc.getTextWidth(macros);

          const gap = 6;
          const maxTitleW = Math.max(40, (rightX - leftX) - macrosW - gap);

          // Puce
          setText(doc, 9.5, C.ink[0], C.ink[1], C.ink[2], "normal");
          doc.text("•", X + 3.5, cursor.y);

          const title = ellipsisToWidth(doc, titleRaw, maxTitleW);

          // Titre en couleur + lien cliquable (URL absolue)
          setText(doc, 9.5, C.accent2[0], C.accent2[1], C.accent2[2], "normal");
          if (url !== "#") {
            if (typeof doc.textWithLink === "function") {
              doc.textWithLink(title, leftX, cursor.y, { url });
            } else {
              doc.text(title, leftX, cursor.y);
              try {
                const tw = doc.getTextWidth(title);
                doc.link(leftX, cursor.y - 4, tw, 5, { url });
              } catch (_) {}
            }
          } else {
            doc.text(title, leftX, cursor.y);
          }

          // Macros à droite
          setText(doc, 9.5, C.muted[0], C.muted[1], C.muted[2], "normal");
          doc.text(macros, rightX, cursor.y, { align: "right" });

          // Indicateur verrouillé
          if (s?.locked) {
            setText(doc, 9.5, C.warn[0], C.warn[1], C.warn[2], "bold");
            doc.text("🔒", rightX - macrosW - 5, cursor.y);
          }

          cursor.y += 6;
        }

        cursor.y += 2;
      }

      // Total jour (carte)
      ensureSpace(doc, cursor, 14);
      doc.setDrawColor(C.cardBorder[0], C.cardBorder[1], C.cardBorder[2]);
      doc.setLineWidth(0.2);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(X, cursor.y - 2, W, 10, 2, 2, "D");

      setText(doc, 10.5, C.ink[0], C.ink[1], C.ink[2], "bold");
      doc.text("Total jour", X + 3, cursor.y + 4);

      setText(doc, 9.5, C.muted[0], C.muted[1], C.muted[2], "normal");
      doc.text(
        `P ${fmt1(dayP)} g · ${Math.round(dayK)} kcal · G net ${fmt1(dayC)} g · L ${fmt1(dayF)} g`,
        X + W - 3,
        cursor.y + 4,
        { align: "right" }
      );

      cursor.y += 14;
    }

    // Liste de courses (dernière page dédiée)
    renderShoppingList(doc, cursor, MB, menu.slice(0, safeDaysCount), C, pageW);

    doc.save(buildPdfFileName());
  }

  function setExportEnabled(enabled) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.disabled = !enabled;
  }

  function setup() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    const hasMenu = Array.isArray(global.MenuBuilder?.state?.menu) && global.MenuBuilder.state.menu.length > 0;
    setExportEnabled(hasMenu);

    btn.addEventListener("click", exportMenuToPdf);

    global.addEventListener("menuBuilderRendered", function () {
      const ok = Array.isArray(global.MenuBuilder?.state?.menu) && global.MenuBuilder.state.menu.length > 0;
      setExportEnabled(ok);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})(window);
