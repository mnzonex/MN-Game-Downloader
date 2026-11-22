import assert from "node:assert/strict";
import axios from "axios";
import { searchGogFreeGames } from "../src/scrapers/gog";
import { searchSteamFreeGames } from "../src/scrapers/steam";

type AxiosCall = { url: string; config: any };
const calls: AxiosCall[] = [];
const originalGet = axios.get;

const steamHtml = '<a class="search_result_row" data-ds-appid="570">' +
  '<div class="title">Dota 2</div>' +
  '<div class="search_capsule"><img src="https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg"></div>' +
  '<div class="search_released">Jul 9, 2013</div>' +
  '<div class="search_review_summary" data-tooltip-html="Very Positive"></div>' +
  '<div class="search_price">Free To Play</div></a>';

(axios as any).get = async (url: string, config: any = {}) => {
  const textUrl = String(url);
  calls.push({ url: textUrl, config });

  if (textUrl.startsWith("https://catalog.gog.com/v1/catalog")) {
    const request = new URL(textUrl);
    assert.equal(request.searchParams.get("query"), "like:Beneath a Steel Sky");
    return {
      data: {
        pages: 1,
        products: [{
          id: 1207658695,
          title: "Beneath a Steel Sky (1994)",
          slug: "beneath-a-steel-sky",
          productType: "game",
          operatingSystems: ["windows"],
          coverVertical: "https://images.gog-statics.com/beneath-cover.jpg",
          tags: [{ slug: "free-game", name: "Free Game" }],
          genres: [{ name: "Adventure" }],
          ratings: [],
        }],
      },
    };
  }

  if (textUrl === "https://store.steampowered.com/search/results/") {
    assert.equal(config.params?.term, "Dota 2", "Steam search must use the Store's term parameter");
    assert.equal(config.params?.query, undefined, "Steam must not use the ignored query parameter");
    return { data: { success: 1, results_html: steamHtml, total_count: 1 } };
  }

  if (textUrl === "https://store.steampowered.com/api/appdetails") {
    assert.equal(String(config.params?.appids), "570");
    return {
      data: {
        "570": {
          success: true,
          data: {
            type: "game",
            name: "Dota 2",
            is_free: true,
            platforms: { windows: true, mac: true, linux: true },
            header_image: "https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg",
            genres: [{ description: "Free to Play" }, { description: "Action" }],
            developers: ["Valve"],
            publishers: ["Valve"],
          },
        },
      },
    };
  }

  throw new Error("Unexpected URL in catalogue search test: " + textUrl);
};

async function run() {
  try {
    const gog = await searchGogFreeGames("Beneath a Steel Sky", 1);
    assert.equal(gog.games.length, 1);
    assert.equal(gog.games[0].title, "Beneath a Steel Sky (1994)");
    assert.equal(gog.games[0].sourceId, "gog");
    assert.equal(gog.hasMore, false);

    const steam = await searchSteamFreeGames("Dota 2", 1);
    assert.equal(steam.games.length, 1);
    assert.equal(steam.games[0].title, "Dota 2");
    assert.equal(steam.games[0].sourceId, "steam");
    assert.equal(steam.hasMore, false);

    const gogCall = calls.find((call) => call.url.startsWith("https://catalog.gog.com/v1/catalog"));
    const steamCall = calls.find((call) => call.url === "https://store.steampowered.com/search/results/");
    assert.ok(gogCall, "GOG search endpoint must be called");
    assert.ok(steamCall, "Steam search endpoint must be called");
    assert.equal(new URL(gogCall.url).searchParams.get("query"), "like:Beneath a Steel Sky");
    assert.equal(steamCall.config.params.term, "Dota 2");
    console.log("Catalogue search tests passed: GOG query returns the matching free Windows game; Steam uses the correct term parameter and returns Dota 2 only.");
  } finally {
    (axios as any).get = originalGet;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});