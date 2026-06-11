# Paper Axiv

A static GitHub Pages app for browsing fresh papers from arXiv by search term, category, result count, and submitted date.

## Run Locally

Open `index.html` in a browser, or serve the folder with any static web server.

## Deploy To GitHub Pages

1. Push these files to a GitHub repository.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. Set `Source` to `GitHub Actions`.
5. Go to `Actions` and run the workflow named `Update papers` once. This fills `Github/papers.json` and deploys the `Github/` folder.
6. GitHub will publish the site at the Pages URL shown in the workflow summary and Pages settings.

## Notes

arXiv's API is public, but it does not consistently expose browser CORS headers. This app tries arXiv directly first and then falls back to `api.allorigins.win`, a public CORS proxy, so it can work as a purely static GitHub Pages site.

The dependable path is the included GitHub Actions workflow. It refreshes `papers.json` every day at 06:17 UTC and commits the updated cache back to the repository. The browser reads that same-origin JSON file, so GitHub Pages does not need a backend.

For live arbitrary searches beyond the cached categories, replace the proxy fallback in `app.js` with your own small serverless function on Cloudflare Workers, Netlify Functions, Vercel, or similar infrastructure.
