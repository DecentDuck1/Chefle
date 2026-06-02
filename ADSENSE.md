# Google AdSense Setup

## Recommended Path

Run AdSense on the Squarespace page that embeds Chefle, not inside the Chefle game iframe at first. This keeps the game UI stable and lets Squarespace own the page-level ad placement.

Use one of these approaches:

1. Auto ads: paste the AdSense activation code into Squarespace site-wide header code injection.
2. Manual ad units: paste individual ad unit code into Squarespace Code Blocks above, below, or beside the Chefle iframe.

## Information Needed From Google

- Publisher ID: looks like `ca-pub-0000000000000000`.
- Domain approved in AdSense.
- For manual ad units only: ad slot ID, usually a numeric string.
- If Google asks for it: `ads.txt` line from your AdSense account.

## Squarespace Steps

1. Create or sign in to a Google AdSense account.
2. Add the final public domain that will contain the page visitors see.
3. Wait for Google to review and approve the site.
4. For Auto ads, copy the AdSense code from Ads > Get code.
5. In Squarespace, paste that code into site-wide header code injection.
6. For manual ad units, create an ad unit in AdSense and paste the ad unit code into a Squarespace Code Block where the ad should appear.
7. If AdSense shows an `ads.txt` warning, publish the exact line Google provides at `https://yourdomain.com/ads.txt`.
8. Test logged out or in an incognito window. Ads can take time to appear after code changes.

## Chefle Static Bundle

The generated `publish/` folder includes safe templates:

- `adsense-auto-ads-template.html`
- `adsense-manual-ad-unit-template.html`
- `ads.txt.template`

Do not paste placeholder IDs into a live site. Replace every placeholder first.

## Privacy And Cookies

AdSense may use cookies, device identifiers, ad personalization, fraud prevention, and measurement. Once ads are live, keep the Privacy and Cookies pages published and make sure your Squarespace cookie/consent setup matches the regions you serve.

## CSP Note

The generated Chefle `_headers` file is strict and does not enable Google ad domains. That is intentional while ads are placed on the surrounding Squarespace page. If you later decide to put ads inside `publish/index.html`, the CSP must be updated for AdSense domains and retested.

## Sources

- https://support.google.com/adsense/answer/9261307
- https://support.google.com/adsense/answer/9274019
- https://support.google.com/adsense/answer/9190028
- https://support.google.com/adsense/answer/12171612
- https://support.squarespace.com/hc/en-us/articles/206545597-Can-I-place-advertisements-on-my-site
