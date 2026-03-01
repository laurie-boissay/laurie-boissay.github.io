/* ==============================================================================
menu-pdf.js — Export du menu en PDF (jsPDF)
==============================================================================
Rôle
- Exporter le menu (jours → repas → recettes) en PDF lisible.
- Mettre en forme : bandeaux, sections, couleurs.
- Rendre les titres de recettes cliquables via des URL ABSOLUES (compat PDF).
- Ajouter une "Liste des courses" basée sur les ingrédients des recettes du menu.

Point clé (liens PDF)
- Beaucoup de lecteurs PDF ignorent les annotations dont l’URL est relative.
- On force donc systématiquement une URL absolue (https://…).

Dépendances
- jsPDF UMD : window.jspdf.jsPDF
- MenuBuilder + MenuEngine déjà chargés

Limites (liste des courses)
- On agrège les lignes d’ingrédients telles qu’elles existent dans les fiches.
- Sans parse "intelligent" des quantités : on affiche xN (occurrences) plutôt qu’une somme.
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
  // Liste des courses
  // ---------------------------------------------------------------------------

  /**
   * Extrait une liste d’ingrédients "affichables" depuis l’objet recette.
   * Supporte :
   * - ingredients: ["2 œufs", "..."]
   * - ingredients: [{ label: "2 œufs", link: "/..." }, ...]
   */
  function extractIngredientLines(recipe) {
    const ing = recipe?.ingredients;
    if (!Array.isArray(ing)) return [];

    const out = [];
    for (const item of ing) {
      if (typeof item === "string") {
        const s = item.trim();
        if (s) out.push(s);
        continue;
      }
      if (item && typeof item === "object") {
        const label = String(item.label || "").trim();
        if (label) out.push(label);
      }
    }
    return out;
  }

  /**
   * Construit une Map(label -> count) à partir du menu actuel.
   * Note : "count" = nombre d’occurrences (recettes) où la ligne apparaît.
   */
  function buildShoppingListCounts(menu) {
    const counts = new Map();

    if (!Array.isArray(menu)) return counts;

    for (const dayMeals of menu) {
      if (!Array.isArray(dayMeals)) continue;

      for (const mealObj of dayMeals) {
        const slots = Array.isArray(mealObj?.slots) ? mealObj.slots : [];
        for (const s of slots) {
          const r = s?.recipe;
          if (!r) continue;

          const lines = extractIngredientLines(r);
          for (const line of lines) {
            const key = line; // volontairement "brut" (pas de parsing quantités)
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        }
      }
    }

    return counts;
  }

  function renderShoppingList(doc, cursor, X, W, C, countsMap) {
    // Titre section (nouvelle page si nécessaire)
    ensureSpace(doc, cursor, 22);

    // Si on est trop bas, on préfère une nouvelle page pour un bloc propre.
    const pageH = doc.internal.pageSize.getHeight();
    if (cursor.y > pageH - 60) {
      doc.addPage();
      cursor.y = 18;
    }

    // Bandeau
    drawBand(doc, X, cursor.y - 5, W, 10, C.accent[0], C.accent[1], C.accent[2]);
    setText(doc, 12, 255, 255, 255, "bold");
    doc.text("Liste des courses", X + 3, cursor.y + 2);
    cursor.y += 12;

    setText(doc, 9.5, C.muted[0], C.muted[1], C.muted[2], "italic");
    doc.text("Basée sur les ingrédients des recettes du menu (xN = occurrences).", X, cursor.y);
    cursor.y += 7;

    const entries = Array.from(countsMap.entries())
      .filter(([label]) => String(label || "").trim().length > 0)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "fr", { sensitivity: "base" }));

    if (entries.length === 0) {
      setText(doc, 10, C.muted[0], C.muted[1], C.muted[2], "italic");
      doc.text("— Aucun ingrédient détecté —", X, cursor.y);
      cursor.y += 6;
      return;
    }

    // Rendu : une ligne par ingrédient (tronquée si besoin)
    const leftX = X + 6;
    const rightX = X + W - 3;

    for (const [label, count] of entries) {
      ensureSpace(doc, cursor, 6);

      // Puce
      setText(doc, 9.5, C.ink[0], C.ink[1], C.ink[2], "normal");
      doc.text("•", X + 3.5, cursor.y);

      // Compteur à droite
      setText(doc, 9.5, C.muted[0], C.muted[1], C.muted[2], "normal");
      const countTxt = `x${count}`;
      const countW = doc.getTextWidth(countTxt);
      doc.text(countTxt, rightX, cursor.y, { align: "right" });

      // Libellé (tronqué pour ne pas chevaucher le compteur)
      const gap = 6;
      const maxLabelW = Math.max(50, (rightX - leftX) - countW - gap);
      setText(doc, 9.5, C.ink[0], C.ink[1], C.ink[2], "normal");
      const line = ellipsisToWidth(doc, label, maxLabelW);
      doc.text(line, leftX, cursor.y);

      cursor.y += 6;
    }
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

    // -----------------------------------------------------------------------
    // Ajout : Liste des courses (fin du PDF)
    // -----------------------------------------------------------------------
    const shoppingCounts = buildShoppingListCounts(menu);

    // On force une nouvelle page pour garder un bloc propre.
    doc.addPage();
    cursor.y = 18;

    renderShoppingList(doc, cursor, X, W, C, shoppingCounts);

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
