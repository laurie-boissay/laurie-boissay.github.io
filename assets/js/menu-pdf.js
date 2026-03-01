/* ==============================================================================
menu-pdf.js — Export du menu en PDF (jsPDF)
==============================================================================
Rôle
- Exporter le menu généré (jours → repas → recettes) en PDF lisible.
- Activer/désactiver le bouton #exportMenuPdf selon l’état du menu.

Dépendances
- jsPDF UMD : window.jspdf.jsPDF
- MenuBuilder + MenuEngine (déjà chargés sur la page menu)
============================================================================== */

"use strict";

(function attachMenuPdf(global) {
  const BTN_ID = "exportMenuPdf";

  function getJsPdfCtor() {
    // jsPDF UMD : window.jspdf.jsPDF
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

  function getDayLabel(dayOffset, weekStart, daysArr) {
    const startIndex = weekStart === 0 ? 6 : weekStart - 1;
    const dayIndex = (startIndex + dayOffset) % 7;
    return daysArr[dayIndex] || `Jour ${dayOffset + 1}`;
  }

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

  function ensureSpace(doc, cursor, neededMm) {
    const pageH = doc.internal.pageSize.getHeight();
    const bottom = pageH - 12;

    if (cursor.y + neededMm <= bottom) return cursor;

    doc.addPage();
    cursor.y = 14;
    return cursor;
  }

  function writeLine(doc, cursor, text, opts = {}) {
    const x = opts.x ?? 14;
    const fontSize = opts.fontSize ?? 11;
    const indent = opts.indent ?? 0;
    const maxWidth = opts.maxWidth ?? (doc.internal.pageSize.getWidth() - 28 - indent);
    const lineHeight = opts.lineHeight ?? (fontSize * 0.42 + 2.4);

    doc.setFontSize(fontSize);

    const lines = doc.splitTextToSize(String(text), maxWidth);
    const need = lines.length * lineHeight;
    ensureSpace(doc, cursor, need);

    doc.text(lines, x + indent, cursor.y);
    cursor.y += need;

    return cursor;
  }

  function buildPdfFileName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `menu_${y}-${m}-${day}.pdf`;
  }

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
    const safeDaysCount = Math.max(1, Math.min(7, parseInt(params.daysCount, 10) || 3));

    const doc = new JsPdf({ unit: "mm", format: "a4" });
    const cursor = { y: 16 };

    // Titre
    doc.setFontSize(18);
    doc.text("Menu", 14, cursor.y);
    cursor.y += 8;

    doc.setFontSize(10);
    doc.text(`Exporté le ${new Date().toLocaleDateString("fr-FR")}`, 14, cursor.y);
    cursor.y += 8;

    const mealLabels =
      MB.MEAL_LABELS_BY_COUNT?.[params.mealsPerDay] ||
      MB.MEAL_LABELS_BY_COUNT?.[3] ||
      [];

    for (let dayOffset = 0; dayOffset < safeDaysCount; dayOffset += 1) {
      const dayMeals = menu[dayOffset];
      if (!Array.isArray(dayMeals)) continue;

      // En-tête jour
      cursor.y += 2;
      ensureSpace(doc, cursor, 10);
      doc.setFontSize(14);
      doc.text(getDayLabel(dayOffset, params.weekStart, MB.DAYS), 14, cursor.y);
      cursor.y += 6;

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

        // En-tête repas + totaux
        cursor.y += 1;
        ensureSpace(doc, cursor, 10);
        writeLine(
          doc,
          cursor,
          `${label} — P ${fmt1(totals.protein)} g · ${Math.round(totals.kcal)} kcal · G net ${fmt1(totals.netCarbs)} g`,
          { fontSize: 11 }
        );

        // Lignes recettes
        if (totals.slots.length === 0) {
          writeLine(doc, cursor, "(aucun slot)", { fontSize: 10, indent: 4 });
          continue;
        }

        for (const s of totals.slots) {
          const r = s?.recipe;
          const title = r?.title || "—";
          const kcal = safeNum(MenuEngine.getRecipeCalories(r));
          const prot = safeNum(MenuEngine.getRecipeProtein(r));
          const carbs = safeNum(MenuEngine.getRecipeNetCarbs(r));

          const lock = s?.locked ? " 🔒" : "";
          writeLine(
            doc,
            cursor,
            `• ${title}${lock} — P ${fmt1(prot)} g · ${Math.round(kcal)} kcal · G net ${fmt1(carbs)} g`,
            { fontSize: 10, indent: 4 }
          );
        }
      }

      // Totaux jour
      cursor.y += 1;
      ensureSpace(doc, cursor, 10);
      doc.setFontSize(11);
      doc.text(
        `Total jour — P ${fmt1(dayP)} g · ${Math.round(dayK)} kcal · G net ${fmt1(dayC)} g · L ${fmt1(dayF)} g`,
        14,
        cursor.y
      );
      cursor.y += 7;

      // Séparateur
      doc.setDrawColor(200);
      doc.line(14, cursor.y - 3, doc.internal.pageSize.getWidth() - 14, cursor.y - 3);
    }

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

    // Activer si un menu existe déjà
    const hasMenu = Array.isArray(global.MenuBuilder?.state?.menu) && global.MenuBuilder.state.menu.length > 0;
    setExportEnabled(hasMenu);

    btn.addEventListener("click", exportMenuToPdf);

    // Activation après rendu du menu
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
