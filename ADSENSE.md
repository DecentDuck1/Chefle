# Google AdSense Setup

## Recommended Path

Run AdSense on the Squarespace page that embeds Chefle, not inside the Chefle game iframe at first. This keeps the game UI stable and lets Squarespace own the page-level ad placement.

Use one of these approaches:

1. Auto ads: paste the AdSense activation code into Squarespace site-wide header code injection.
2. Manual ad units: paste individual ad unit code into Squarespace Code Blocks above, below, or beside the Chefle iframe.

## Information Needed From Google

- Publisher ID: `ca-pub-4681241502820822`.
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
7. Confirm `https://yourdomain.com/ads.txt` is reachable and contains the exact line Google provides. The current repo line is `google.com, pub-4681241502820822, DIRECT, f08c47fec0942fa0`.
8. Test logged out or in an incognito window. Ads can take time to appear after code changes.

## Review-Readiness Hardening

Based on Google's AdSense readiness and policy docs, keep these pieces live and crawlable before requesting another review:

- Original, useful page content that explains what Chefle is and how the puzzle works.
- Clear navigation to About, Contact, Privacy, Terms, Cookies, Accessibility, and Disclaimer pages.
- AdSense code limited to game/original content pages, not legal/support screens with little publisher content.
- A privacy/cookie disclosure that explains Google ad technology and points visitors to Google's partner-site data explanation.
- A reachable root `ads.txt` file that does not contain placeholder publisher IDs.
- No click encouragement, fake ad labels, hidden ad containers, copied article content, scraped recipes, or low-value placeholder pages.

## Chefle Static Bundle

The generated `publish/` folder is the public site bundle. It should include the game, legal/info pages, assets, hosting files, and `ads.txt`; it should not include setup notes, placeholder ad-unit templates, or other review utilities.

The source repo still keeps setup references for local use:

- `adsense-auto-ads-template.html`
- `adsense-manual-ad-unit-template.html`
- `ads.txt.template`

Do not deploy placeholder template files to the public review domain. If AdSense provides a different exact `ads.txt` line, replace both `ads.txt` and `ads.txt.template`, then run `node scripts/build-publish.js`.

## Privacy And Cookies

AdSense may use cookies, device identifiers, ad personalization, fraud prevention, and measurement. Once ads are live, keep the Privacy and Cookies pages published and make sure your Squarespace cookie/consent setup matches the regions you serve.

## CSP Note

The generated Chefle `_headers` file is strict and does not enable Google ad domains. That is intentional while ads are placed on the surrounding Squarespace page. If you later decide to put ads inside `publish/index.html`, the CSP must be updated for AdSense domains and retested.

## Sources

- https://support.google.com/adsense/answer/9724
- https://support.google.com/adsense/answer/7299563
- https://support.google.com/adsense/answer/1348695
- https://support.google.com/adsense/answer/10502938
- https://support.google.com/adsense/answer/7532444
- https://policies.google.com/technologies/partner-sites
- https://www.google.com/about/company/user-consent-policy/
- https://support.google.com/adsense/answer/9261307
- https://support.google.com/adsense/answer/9274019
- https://support.google.com/adsense/answer/9190028
- https://support.google.com/adsense/answer/12171612
- https://support.squarespace.com/hc/en-us/articles/206545597-Can-I-place-advertisements-on-my-site
