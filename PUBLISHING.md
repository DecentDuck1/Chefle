# Chefle Publishing Notes

## Recommended Deployment

Use the generated `publish/` folder as the production artifact.

1. Run `node scripts/build-publish.js`.
2. Upload the complete `publish/` folder to a static host that preserves relative paths.
3. Put the hosted `index.html` URL into `publish/squarespace-iframe-snippet.html`.
4. Paste that iframe snippet into a Squarespace Code Block.

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
- `privacy.html`
- `terms.html`
- `cookies.html`
- `accessibility.html`
- `disclaimer.html`
- `ADSENSE.md`
- `adsense-auto-ads-template.html`
- `adsense-manual-ad-unit-template.html`
- `ads.txt.template`
- `assets/food-pattern.svg`
- `assets/earth-equirectangular.jpg`
- `food-photo-review-specific-only-v3/*.jpg`

The build script copies only the 273 production dish images referenced by the app.

## CSP

The source app keeps an inline-script-compatible CSP because Squarespace and single-file local testing are brittle with strict hash policies. If the app is hosted on a controlled static host and verified in browsers, a stricter hashed CSP can be added at the host/header layer.

The generated `publish/_headers` file includes a stricter script hash CSP, `Referrer-Policy`, `X-Content-Type-Options`, and a restrictive `Permissions-Policy` for hosts that support `_headers`, such as Netlify-style static hosting. It intentionally omits `X-Frame-Options` and `frame-ancestors` because those can block the Squarespace iframe. If you add `frame-ancestors`, include the final Squarespace and custom-domain origins.

Configure HTTPS and HSTS at the final host after confirming the site is served only over HTTPS. Do not enable HSTS preload until the final domain setup is stable.

## Privacy

The footer links to `privacy.html`, `terms.html`, `cookies.html`, `accessibility.html`, and `disclaimer.html`; these files are included in the source and copied into `publish/`. Chefle stores game progress, stats, settings, and trusted-time data in browser `localStorage`; it does not use accounts, payments, email capture, ad pixels, third-party analytics, cookies, geolocation, camera, microphone, or a database. Squarespace and the static host may still process normal technical data such as IP address, browser type, cookies, and access logs.

If you add analytics, ads, API integrations, login, comments, forms, or payment features later, update the privacy notice before publishing those changes.

## Google AdSense

Read `ADSENSE.md` before turning on ads. The generated AdSense files are templates only; they do not load ads until placeholder IDs are replaced with real Google values and pasted into Squarespace or your static host. For the current Squarespace iframe setup, place ads on the surrounding Squarespace page first instead of inside the Chefle iframe.

If AdSense asks for `ads.txt`, use the exact line Google provides and publish it at the root of the final domain, for example `https://example.com/ads.txt`. Squarespace notes that root-level `ads.txt` may require a custom workaround.

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
