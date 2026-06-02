const query = process.argv.slice(2).join(" ");
const url = new URL("https://www.bing.com/images/async");
url.search = new URLSearchParams({ q: query, first: "1", count: "20", adlt: "strict" }).toString();

fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
  .then(async (response) => {
    const text = await response.text();
    const matches = Array.from(text.matchAll(/m="([^"]+)"/g)).slice(0, 8).map((match) => {
      const raw = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    });
    console.log(JSON.stringify({
      status: response.status,
      length: text.length,
      murlCount: (text.match(/murl/g) || []).length,
      iuscCount: (text.match(/class="iusc"/g) || []).length,
      matches,
      sample: text.slice(0, 1000)
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
