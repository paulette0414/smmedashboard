# DepEd Romblon — School Performance Indicators Dashboard

Interactive dashboard (React + Recharts) para sa School Performance Indicators
ng Schools Division of Romblon, SY 2023–2024 hanggang SY 2025–2026.

Kasama sa dashboard:
- **Division Overview** — KPI summary, 3-year rate trends (GER/NER/Cohort Survival/Completion/Dropout), MPS by subject, enrolment by municipality, OPCRF distribution
- **School Explorer** — sortable table ng 299 schools na may drill-down detail view per school
- **Municipality filter** ("archipelago strip") — i-click ang kahit anong munisipyo para i-filter ang buong dashboard

## Paano patakbuhin nang lokal

```bash
npm install
npm run dev
```

Buksan ang link na lalabas sa terminal (karaniwan ay `http://localhost:5173`).

## Paano i-deploy sa GitHub Pages

1. I-push ang repo na ito sa GitHub (tingnan ang mga steps sa ibaba).
2. Sa `vite.config.js`, siguraduhing tama ang `base` — dapat match sa pangalan ng iyong GitHub repo:
   ```js
   base: '/your-repo-name/',
   ```
3. I-install ang gh-pages (nasa devDependencies na, kasama sa `npm install`).
4. Patakbuhin:
   ```bash
   npm run deploy
   ```
5. Sa GitHub repo Settings → Pages, piliin ang **gh-pages** branch bilang source.
6. Makukuha mo ang live link sa `https://<username>.github.io/<repo-name>/`

## Paano i-push sa GitHub (unang beses)

```bash
git init
git add .
git commit -m "Initial commit: DepEd Romblon dashboard"
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

## Pag-update ng data

Ang data ay naka-embed sa `src/App.jsx` bilang `SCHOOLS` array (mula sa
School_Performance_Indicators.xlsx). Kung may bagong data, kailangang i-generate
ulit ang array na ito mula sa updated na Excel file.
