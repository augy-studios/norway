/* Absolutely Norway — home directory: renders the page grid + search filter. */

(function () {
  "use strict";

  const PAGES = [
    {
      title: "Statistics Norway",
      desc: "Live population, price and economic figures straight from SSB's StatBank.",
      href: "/stats",
      icon: "chart",
      status: "live",
      tags: ["stats", "statistics", "ssb", "economy", "inflation", "cpi", "population"],
    },
    {
      title: "Entity Lookup",
      desc: "Look up any Norwegian registered company by org number or name via Brreg.",
      href: "/entities",
      icon: "pin",
      status: "live",
      tags: ["entities", "brreg", "company", "org number", "enhetsregisteret", "kyb"],
    },
    {
      title: "Weather",
      desc: "Live forecasts and UV index for Norwegian cities, from MET Norway and NILU.",
      href: "/weather",
      icon: "cloud",
      status: "live",
      tags: ["weather", "forecast", "met", "uv", "uv index", "nilu"],
    },
    {
      title: "Currency & Rates",
      desc: "Official NOK exchange rates and the key policy rate from Norges Bank.",
      href: "/bank",
      icon: "coin",
      status: "live",
      tags: ["currency", "exchange", "nok", "norges bank", "converter", "policy rate", "interest"],
    },
    {
      title: "Library Search",
      desc: "Search the National Library's digitized books, newspapers and images.",
      href: "/library",
      icon: "book",
      status: "live",
      tags: ["library", "books", "nasjonalbiblioteket", "national library", "newspapers", "archive"],
    },
    {
      title: "Public Holidays",
      desc: "Norwegian public holidays and flag-flying days.",
      href: "#",
      icon: "calendar",
      status: "soon",
      tags: ["holidays", "calendar", "flag days"],
    },
    {
      title: "Ferry & Transit",
      desc: "Coastal ferry and public transit lookups.",
      href: "#",
      icon: "anchor",
      status: "soon",
      tags: ["ferry", "transit", "transport"],
    },
  ];

  const grid = document.getElementById("directory-grid");
  const noResults = document.getElementById("no-results");
  const searchInput = document.getElementById("site-search");

  function cardHtml(page) {
    const icons = window.NorwayIcons || {};
    const isSoon = page.status === "soon";
    const badge = isSoon
      ? '<span class="badge badge-soon">Coming soon</span>'
      : '<span class="badge badge-live">' + (icons.check || "") + " Live</span>";
    return (
      '<article class="directory-card glass' + (isSoon ? " is-disabled" : "") + '" data-tags="' +
      page.tags.join(" ") + " " + page.title.toLowerCase() + '">' +
      '<div class="card-top">' +
      '<div class="card-icon">' + (icons[page.icon] || "") + "</div>" +
      '<span class="card-title">' + page.title + "</span>" +
      "</div>" +
      '<p class="card-desc">' + page.desc + "</p>" +
      badge +
      (isSoon
        ? ""
        : '<a class="card-link" href="' + page.href + '" aria-label="Open ' + page.title + '"></a>') +
      "</article>"
    );
  }

  function render() {
    grid.innerHTML = PAGES.map(cardHtml).join("");
  }

  function filter(query) {
    const q = query.trim().toLowerCase();
    const cards = grid.querySelectorAll(".directory-card");
    let visible = 0;
    cards.forEach((card) => {
      const match = !q || card.dataset.tags.includes(q);
      card.style.display = match ? "" : "none";
      if (match) visible += 1;
    });
    noResults.classList.toggle("is-visible", visible === 0);
  }

  render();
  searchInput.addEventListener("input", (e) => filter(e.target.value));
})();
