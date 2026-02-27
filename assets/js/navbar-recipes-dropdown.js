/**
 * assets/js/navbar-recipes-dropdown.js
 *
 * Rôle
 * - Injecter dynamiquement la liste des groupes de recettes
 *   dans le dropdown "Recettes" de la navbar.
 *
 * Optimisation
 * - Supprime toute boucle Liquid coûteuse (scan + group_by + sort).
 *
 * Contrat JSON attendu
 * - /assets/data/recipes.json
 * - Tableau d’objets contenant un champ `recipe_group`
 *
 * Intégration navigation
 * - Les liens générés portent la classe `.recipes-group-chip`
 *   pour activer fermeture menu mobile + offset d’ancre.
 *
 * Important (compatibilité ancres)
 * - Les ancres de la home sont générées via Liquid `| slugify`.
 * - Ton site semble utiliser un slugify "pretty" (accents + œ conservés).
 * - Donc ici on génère aussi un slug "pretty" (unicode conservé).
 */

(() => {
  const loadingEl = document.getElementById("recipes-groups-loading");
  const anchorEl = document.getElementById("recipes-groups-container");

  if (!anchorEl) return;

  const dataUrl = anchorEl.getAttribute("data-recipes-json");
  const baseUrl = anchorEl.getAttribute("data-baseurl") || "";

  const setErrorState = () => {
    if (loadingEl) {
      loadingEl.textContent = "Groupes indisponibles (JS).";
      loadingEl.classList.remove("text-muted");
    }
  };

  if (!dataUrl) {
    setErrorState();
    return;
  }

  /**
   * Slugify "pretty" (unicode conservé) pour matcher Liquid `slugify`
   * quand les IDs de sections conservent accents et œ.
   *
   * Règles :
   * - minuscules
   * - apostrophes supprimées
   * - tout ce qui n'est pas lettre/nombre unicode -> "-"
   * - trim + compression des "-"
   */
  const slugifyPretty = (input) =>
    String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "") // supprime apostrophes droites + typographiques
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-") // garde accents + œ
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");

  fetch(dataUrl, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((recipes) => {
      if (!Array.isArray(recipes)) {
        throw new Error("JSON non conforme (tableau attendu).");
      }

      const groupsSet = new Set();
      for (const item of recipes) {
        const g =
          item && typeof item.recipe_group === "string"
            ? item.recipe_group.trim()
            : "";
        if (g) groupsSet.add(g);
      }

      const groups = Array.from(groupsSet).sort((a, b) =>
        a.localeCompare(b, "fr")
      );

      if (loadingEl) loadingEl.remove();

      const frag = document.createDocumentFragment();

      for (const name of groups) {
        const li = document.createElement("li");
        const a = document.createElement("a");

        const hash = slugifyPretty(name);

        a.className = "dropdown-item recipes-group-chip";
        a.href = `${baseUrl}/#${hash}`;
        a.textContent = name;

        li.appendChild(a);
        frag.appendChild(li);
      }

      anchorEl.parentNode.insertBefore(frag, anchorEl);
      anchorEl.remove();
    })
    .catch(() => setErrorState());
})();
