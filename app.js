const form = document.querySelector("#paperForm");
const queryInput = document.querySelector("#queryInput");
const categoryInput = document.querySelector("#categoryInput");
const limitInput = document.querySelector("#limitInput");
const sinceInput = document.querySelector("#sinceInput");
const resetButton = document.querySelector("#resetButton");
const copyButton = document.querySelector("#copyButton");
const message = document.querySelector("#message");
const paperList = document.querySelector("#papers");
const paperTemplate = document.querySelector("#paperTemplate");
const resultsTitle = document.querySelector("#resultsTitle");
const connectionStatus = document.querySelector("#connectionStatus");

let storedPapers = [];
let currentPapers = [];

const topicQueries = {
  "topic:weather-forecasting": ["weather forecasting", "weather forecast", "meteorology"],
  "topic:microclimate-modelling": ["microclimate modelling", "microclimate modeling", "urban microclimate"],
  "topic:vision-language": ["vision-language", "vision language", "multimodal"],
  "topic:llm": ["large language model", "LLM", "language model"]
};

const defaultSince = new Date();
defaultSince.setDate(defaultSince.getDate() - 14);
sinceInput.value = defaultSince.toISOString().slice(0, 10);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  renderFilteredPapers();
});

resetButton.addEventListener("click", () => {
  queryInput.value = "machine learning";
  categoryInput.value = "cs.LG";
  limitInput.value = "25";
  sinceInput.value = defaultSince.toISOString().slice(0, 10);
  renderFilteredPapers();
});

copyButton.addEventListener("click", async () => {
  const text = currentPapers
    .map((paper, index) => `${index + 1}. ${paper.title}\n${paper.abstractUrl}\n${paper.summary}`)
    .join("\n\n");

  await navigator.clipboard.writeText(text);
  setStatus("Copied");
  setTimeout(() => setStatus("Ready"), 1600);
});

async function init() {
  setStatus("Loading");
  showMessage("Loading the latest paper cache...");

  try {
    const payload = await fetchPaperCache();
    storedPapers = normalizePapers(payload.papers || []);

    if (!storedPapers.length) {
      showMessage("The local paper cache is empty. Run the GitHub Action named \"Update papers\" to fetch the latest arXiv results.");
    }

    updateCacheMetadata(payload);
    renderFilteredPapers();
    setStatus("Ready");
  } catch (cacheError) {
    console.warn("Could not load papers.json, trying live arXiv fetch.", cacheError);
    await fetchLiveFallback();
  }
}

async function fetchPaperCache() {
  const response = await fetch(`papers.json?cache=${Date.now()}`);

  if (!response.ok) {
    throw new Error(`papers.json returned ${response.status}`);
  }

  return response.json();
}

function updateCacheMetadata(payload) {
  const generated = payload.generatedAt ? ` Cache updated ${formatDate(payload.generatedAt)}.` : "";
  const count = storedPapers.length;

  showMessage(`${count} cached paper${count === 1 ? "" : "s"} available.${generated}`);
}

function renderFilteredPapers() {
  const query = queryInput.value.trim().toLowerCase();
  const category = categoryInput.value;
  const limit = Number(limitInput.value);
  const papers = storedPapers
    .filter((paper) => matchesQuery(paper, query))
    .filter((paper) => matchesCategory(paper, category))
    .filter(isAfterSinceDate)
    .slice(0, limit);

  currentPapers = papers;
  renderPapers(papers);
}

function matchesQuery(paper, query) {
  if (!query) {
    return true;
  }

  const searchable = [paper.title, paper.summary, paper.authors.join(" "), paper.categories.join(" ")]
    .join(" ")
    .toLowerCase();
  return query.split(/\s+/).every((term) => searchable.includes(term));
}

function matchesCategory(paper, category) {
  if (!category) {
    return true;
  }

  if (category.startsWith("topic:")) {
    return matchesTopic(paper, category);
  }

  return paper.categories.includes(category) || paper.primaryCategory === category;
}

function matchesTopic(paper, topic) {
  if (paper.matchedTopics.includes(topic)) {
    return true;
  }

  const terms = topicQueries[topic] || [];
  const searchable = [paper.title, paper.summary, paper.authors.join(" "), paper.categories.join(" ")]
    .join(" ")
    .toLowerCase();

  return terms.some((term) => searchable.includes(term.toLowerCase()));
}

async function fetchLiveFallback() {
  const query = queryInput.value.trim();
  const category = categoryInput.value;
  const limit = Number(limitInput.value);
  const since = sinceInput.value;

  if (!query && !category) {
    showMessage("Enter search terms or choose a category.", "error");
    setStatus("Error", true);
    return;
  }

  setStatus("Live fetch");
  showMessage("The local cache was unavailable, so the app is trying a live arXiv request.");
  paperList.replaceChildren();
  copyButton.disabled = true;
  currentPapers = [];

  try {
    const url = buildArxivUrl({ query, category, limit, since });
    const xmlText = await fetchArxivXml(url);
    const papers = parseArxivFeed(xmlText).filter(isAfterSinceDate);

    storedPapers = papers;
    currentPapers = papers;
    renderPapers(papers);
    setStatus("Ready");
  } catch (error) {
    console.error(error);
    setStatus("Error", true);
    showMessage(
      "Could not fetch arXiv results. On GitHub Pages, run the scheduled paper update workflow so the site can read papers.json from the same domain.",
      "error"
    );
  }
}

function buildArxivUrl({ query, category, limit, since }) {
  const searchParts = [];

  if (query) {
    searchParts.push(`all:${query}`);
  }

  if (category) {
    if (category.startsWith("topic:")) {
      const topicTerms = topicQueries[category] || [];
      if (topicTerms.length) {
        searchParts.push(`all:"${topicTerms[0]}"`);
      }
    } else {
      searchParts.push(`cat:${category}`);
    }
  }

  const params = new URLSearchParams({
    search_query: searchParts.join(" AND "),
    start: "0",
    max_results: String(limit),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });

  return `https://export.arxiv.org/api/query?${params.toString()}`;
}

async function fetchArxivXml(url) {
  try {
    return await fetchXml(url);
  } catch (directError) {
    setStatus("Proxy fallback");
    console.warn("Direct arXiv fetch failed, trying CORS proxy.", directError);
    return fetchXml(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
  }
}

async function fetchXml(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Fetch returned ${response.status}`);
  }

  return response.text();
}

function parseArxivFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");

  if (parseError) {
    throw new Error("Could not parse arXiv XML response.");
  }

  return normalizePapers(
    [...doc.querySelectorAll("entry")].map((entry) => {
      const links = [...entry.querySelectorAll("link")];
      const abstractUrl = entry.querySelector("id")?.textContent.trim() || "#";
      const pdfUrl =
        links.find((link) => link.getAttribute("title") === "pdf")?.getAttribute("href") ||
        abstractUrl.replace("/abs/", "/pdf/");
      const categories = [...entry.querySelectorAll("category")].map((node) => node.getAttribute("term"));

      return {
        id: abstractUrl.split("/").pop(),
        title: cleanText(entry.querySelector("title")?.textContent),
        authors: [...entry.querySelectorAll("author name")].map((node) => node.textContent.trim()),
        summary: cleanText(entry.querySelector("summary")?.textContent),
        published: entry.querySelector("published")?.textContent.trim(),
        updated: entry.querySelector("updated")?.textContent.trim(),
        categories,
        primaryCategory: categories[0] || "",
        abstractUrl,
        pdfUrl
      };
    })
  );
}

function normalizePapers(papers) {
  return papers
    .map((paper) => ({
      ...paper,
      title: cleanText(paper.title),
      authors: Array.isArray(paper.authors) ? paper.authors : [],
      summary: cleanText(paper.summary),
      categories: Array.isArray(paper.categories) ? paper.categories : [],
      matchedTopics: Array.isArray(paper.matchedTopics) ? paper.matchedTopics : [],
      primaryCategory: paper.primaryCategory || paper.categories?.[0] || "",
      abstractUrl: paper.abstractUrl || `https://arxiv.org/abs/${paper.id}`,
      pdfUrl: paper.pdfUrl || `https://arxiv.org/pdf/${paper.id}`
    }))
    .sort((a, b) => new Date(b.published) - new Date(a.published));
}

function isAfterSinceDate(paper) {
  if (!sinceInput.value) {
    return true;
  }

  const since = new Date(`${sinceInput.value}T00:00:00`);
  const submitted = new Date(paper.published);
  return submitted >= since;
}

function renderPapers(papers) {
  paperList.replaceChildren();

  if (!papers.length) {
    resultsTitle.textContent = "No matching papers";
    showMessage("No papers matched those filters. Try an older submitted-since date, fewer search terms, or a broader category.");
    copyButton.disabled = true;
    return;
  }

  resultsTitle.textContent = `${papers.length} paper${papers.length === 1 ? "" : "s"} found`;
  message.hidden = true;
  copyButton.disabled = false;

  const fragment = document.createDocumentFragment();

  papers.forEach((paper) => {
    const node = paperTemplate.content.cloneNode(true);
    node.querySelector(".date").textContent = formatDate(paper.published);
    node.querySelector(".category").textContent = paper.primaryCategory || paper.categories[0] || "arXiv";
    node.querySelector("h3").textContent = paper.title;
    node.querySelector(".authors").textContent = formatAuthors(paper.authors);
    node.querySelector(".summary").textContent = paper.summary;
    node.querySelector(".abstract-link").href = paper.abstractUrl;
    node.querySelector(".pdf-link").href = paper.pdfUrl;
    fragment.append(node);
  });

  paperList.append(fragment);
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function formatAuthors(authors) {
  if (!authors.length) {
    return "Unknown authors";
  }

  if (authors.length <= 5) {
    return authors.join(", ");
  }

  return `${authors.slice(0, 5).join(", ")} and ${authors.length - 5} more`;
}

function formatDate(value) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function showMessage(text, type = "") {
  message.hidden = false;
  message.textContent = text;
  message.className = type ? `message ${type}` : "message";
}

function setStatus(text, isError = false) {
  connectionStatus.textContent = text;
  connectionStatus.classList.toggle("error", isError);
}

init();
