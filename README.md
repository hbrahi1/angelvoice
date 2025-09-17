# angelvoice

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```

## Deploy to GitHub Pages

This project includes a GitHub Actions workflow that builds the app with Vite and deploys it to GitHub Pages. Follow these steps:

1. Push the repository to GitHub (ensure your default branch is `main`).
2. In your GitHub repository, go to Settings → Pages.
   - Set Source to "GitHub Actions" (not Branch).
3. Automatic runs on push:
   - The workflow is configured to run on any push to any branch.
   - Deployment to Pages happens only when pushing to the `main` branch (you can change this in `.github/workflows/deploy.yml`).
4. To trigger a deployment now:
   - Push a commit to `main`, or
   - Manually run the workflow: Actions → "Deploy to GitHub Pages" → Run workflow.
5. After it runs, the site will be available at:
   - Project Pages: `https://<username>.github.io/<repository>/`
   - User/Org Pages (special repo named `<username>.github.io`): `https://<username>.github.io/`

Notes about base path:
- The workflow builds with `--base "/<repository>/"` to correctly serve on Project Pages.
- If this repository is a User/Org Pages repo (named `<username>.github.io`), set the base path to `/`.
  - Easiest way: edit `.github/workflows/deploy.yml` and change `BASE_PATH` to `/`, or set a repository variable named `BASE_PATH` to `/` and modify the build step to use it.

Advanced:
- If your default branch is not `main` (e.g., `master`), either rename it or update:
  - The deploy job condition `if: ${{ github.ref == 'refs/heads/main' }}` to match your branch.
- Custom domain: configure it in Settings → Pages, then the base should usually be `/`.
- SPA routers: if you add Vue Router in history mode later, create a `404.html` that mirrors `index.html` so deep links work on Pages.
