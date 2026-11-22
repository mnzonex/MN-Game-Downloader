# 1.2.3 feed correction

- FitGirl requests now use only the canonical `fitgirl-repacks.site` host. Removed the `fitgirl.ru` fallback, which is not a FitGirl games mirror.
- If `/pop-repacks/` cannot be read, the scraper tries the canonical homepage instead.
- FitGirl upstream failures now surface as connection errors instead of silently appearing as an empty games list.
- Browse starts with the FitGirl feed only. EroLabs is requested only after its tab is selected, so its slower API cannot hold the FitGirl loading state open. Results are filtered by source badge before entering each tab/cache.
- FitGirl search pagination is now forwarded and uses the requested page.