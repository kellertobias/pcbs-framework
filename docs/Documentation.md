# Documentation site

The Markdown guides in `docs/` are the source for
[the user documentation](https://kellertobias.github.io/pcbs-framework/).
VitePress builds the site with local full-text search, grouped navigation,
page outlines, code highlighting and light/dark themes. Pages are rendered to HTML
so the guides remain readable without JavaScript.

## Preview and validate

From the framework repository, install dependencies and start the local server:

```sh
npm ci --ignore-scripts
npm run docs:dev
```

Open the printed local URL, including `/pcbs-framework/`. To verify the production
build and preview it:

```sh
npm run docs:build
npm run docs:preview
```

The build rejects unresolved internal links. Its disposable output is
`docs/.vitepress/dist/`; its cache and output are ignored by Git. The documentation
build does not need KiCad, Python, generated KiCad types or OpenCascade setup.

## Add or update a guide

Edit the existing Markdown owner for a feature. Use relative `.md` links so the
same sources work on GitHub and on the site. Put literal CLI arguments and API
names in backticks, especially values containing angle brackets.

For a new guide, add it to the grouped sidebar in `.vitepress/config.mts`, the
[documentation index](Home.md) and `_Sidebar.md`. The site root includes `Home.md`
so the overview has one source. Run the documentation build and preview the page
at desktop and phone widths before committing.

## GitHub Pages deployment

The Documentation workflow builds pull requests without deploying them. Pushes to
`main` that change documentation, dependency manifests or the workflow build and
deploy the generated HTML to GitHub Pages. The workflow can also be run manually.
It uses the `github-pages` environment and a deployment job with `pages: write`
and `id-token: write`; the build has read-only repository access.

The repository's Pages source must be **GitHub Actions**. The configured base is
`/pcbs-framework/`, matching the repository URL. If the repository name or hosting
path changes, update both the base and sitemap hostname in `.vitepress/config.mts`.
See GitHub's [custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Check the Documentation workflow's deployment result after a push, then open the
published site and follow a guide link. A local build alone does not verify a live
deployment. To restore an earlier site, revert the documentation change on `main`
and let the same workflow redeploy it.
