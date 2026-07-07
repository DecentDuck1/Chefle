# Chefle Publishing Notes

## Recommended Deployment

Use the generated `publish/` folder as the production artifact.

1. Run `node scripts/build-publish.js`.
2. Upload the complete `publish/` folder to a static host that preserves relative paths.
3. Put the hosted `index.html` URL into `publish/squarespace-iframe-snippet.html`.
4. Paste that iframe snippet into a Squarespace Code Block.

For `chefle.org`, the repository is also wired for direct GitHub Pages deployment. The `.github/workflows/deploy-pages.yml` workflow rebuilds `publish/`, validates the game data and launch bundle, then deploys the generated folder as the public site.

To finish the GitHub-side setup after pushing:

1. In `DecentDuck1/Food-Daily-game`, open Settings -> Pages.
2. Under "Build and deployment", set Source to "GitHub Actions".
3. Set the custom domain to `chefle.org`.
4. After DNS propagates and GitHub offers it, enable "Enforce HTTPS".

At the DNS provider for `chefle.org`, configure the apex domain:

- `A` record, name `@`, value `185.199.108.153`
- `A` record, name `@`, value `185.199.109.153`
- `A` record, name `@`, value `185.199.110.153`
- `A` record, name `@`, value `185.199.111.153`

If the DNS provider supports IPv6, also add:

- `AAAA` record, name `@`, value `2606:50c0:8000::153`
- `AAAA` record, name `@`, value `2606:50c0:8001::153`
- `AAAA` record, name `@`, value `2606:50c0:8002::153`
- `AAAA` record, name `@`, value `2606:50c0:8003::153`

For the `www` variant, add:

- `CNAME` record, name `www`, value `DecentDuck1.github.io`

Do not add wildcard DNS records such as `*.chefle.org`.

Do not paste the full `chefle.html` document directly into a Squarespace Code Block. Squarespace Code Blocks are page content, not a full document shell, so `<head>` metadata, global CSS, fixed positioning, and local asset paths can behave differently than they do in a standalone file.

Also, Squarespace Code Blocks have a 400 KB code limit. The HTML may fit today, but a Code Block cannot carry the complete image bundle or preserve the standalone document environment. The reliable path is to host the generated static bundle elsewhere and embed it.

## Squarespace Findings

- Squarespace supports client-side custom code, but JavaScript Code Blocks and Code Injection depend on plan level.
- Squarespace does not support server-side code, so Chefle must stay fully static.
- Squarespace notes that custom code may not appear while you are logged in, may fail on index pages, and can conflict with Ajax loading. Test in an incognito window.
- Squarespace developer docs warn that DOM structure and non-specified properties can change unexpectedly. Chefle should run in an iframe so it does not depend on Squarespace DOM internals.

## Asset Paths

`publish/index.html` expects these relative paths to exist next to it:

- `chefle-logo.png`
- `about.html`
- `how-to-play.html`
- `food-clues.html`
- `contact.html`
- `privacy.html`
- `terms.html`
- `cookies.html`
- `accessibility.html`
- `disclaimer.html`
- `assets/food-pattern.svg`
- `assets/earth-equirectangular.jpg`
- `food-photo-review-specific-only-v3/*.jpg`

The build script copies only the 273 production dish images referenced by the app.

## CSP

The source app keeps an inline-script-compatible CSP for local single-file testing. The generated `publish/index.html` and `publish/_headers` file use an ad-friendly script policy so the configured third-party ad snippets can inject their provider scripts and iframes.

The generated `publish/_headers` file includes the same ad-friendly CSP, `Referrer-Policy`, `X-Content-Type-Options`, and a restrictive `Permissions-Policy` for hosts that support `_headers`, such as Netlify-style static hosting. GitHub Pages ignores `_headers`, but `publish/index.html` still applies the production script CSP through its meta tag. The `_headers` file intentionally omits `X-Frame-Options` and `frame-ancestors` because those can block Squarespace iframe embedding. If you add `frame-ancestors` at another host, include the final Squarespace and custom-domain origins.

Configure HTTPS and HSTS at the final host after confirming the site is served only over HTTPS. Do not enable HSTS preload until the final domain setup is stable.

## Privacy

The footer links to `about.html`; support/legal utility pages are still copied into `publish/` for direct access. Chefle stores game progress, stats, settings, and trusted-time data in browser `localStorage`; it does not use accounts, payments, email capture, comments, geolocation, camera, microphone, or a database. The app includes third-party advertising snippets on the game page only; utility/legal pages should remain ad-code-free. Keep the Privacy and Cookies pages accurate before publication. Squarespace, advertising partners, and the static host may still process normal technical data such as IP address, browser type, cookies, identifiers, and access logs.

If you add analytics, ads, API integrations, login, comments, forms, or payment features later, update the privacy notice before publishing those changes.

## Third-Party Ad Snippet

The game page includes the configured third-party advertising code in body placements: page-level top and bottom banner slots, desktop side-rail banner slots, and modal banner slots. The production CSP allows inline ad bootstrap code plus HTTPS third-party scripts and frames because the ad providers can load follow-up assets from rotating domains. If an advertising provider changes its snippet shape, update `chefle.html`, `scripts/build-publish.js`, and the launch audits together.

## QA Checklist

- Test the hosted `publish/index.html` directly in Chrome, Safari, Firefox, iPhone Safari, and Android Chrome.
- Test the Squarespace iframe page while logged out or in an incognito window.
- Confirm the daily rollover uses the intended Pacific Time date.
- Confirm the iframe height works on mobile and desktop.
- Confirm all food images load from the hosted publish path.

## Squarespace References

- https://support.squarespace.com/hc/en-us/articles/205815928-Adding-custom-code-to-your-site
- https://support.squarespace.com/hc/en-us/articles/206543167-Code-blocks
- https://support.squarespace.com/hc/en-us/articles/206543617-Embed-blocks
