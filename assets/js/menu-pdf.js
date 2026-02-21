// Fonction pour générer le PDF du menu
function generatePdfMenu() {
  console.log("Génération du PDF...");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Titre du document PDF
  doc.setFontSize(18);
  doc.text("Menu de la Semaine", 14, 20);

  // Parcours du menu et ajout des informations
  MENU.forEach((dayMeals, dayIndex) => {
    const dayLabel = DAYS[getDayIndex(dayIndex, 0)];
    
    doc.setFontSize(14);
    doc.text(`${dayLabel}:`, 14, doc.lastAutoTable.finalY + 10);

    // Pour chaque repas dans le jour
    dayMeals.forEach((mealObj, mealIndex) => {
      const mealLabel = MEAL_LABELS_BY_COUNT[3][mealIndex] || `Repas ${mealIndex + 1}`;

      doc.setFontSize(12);
      doc.text(mealLabel, 14, doc.lastAutoTable.finalY + 5);

      // Pour chaque slot de repas (plat, dessert, etc.)
      mealObj.slots.forEach((slotObj) => {
        const recipe = slotObj.recipe || {};
        const title = recipe.title || "Non défini";
        const calories = getRecipeCalories(recipe);

        doc.text(`${title} — ${calories} kcal`, 20, doc.lastAutoTable.finalY + 5);
      });
    });
  });

  // Sauvegarde le PDF sous le nom 'menu_semaine.pdf'
  doc.save('menu_semaine.pdf');
}
