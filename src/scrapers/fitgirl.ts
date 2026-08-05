import axios from 'axios';
import * as cheerio from 'cheerio';
import { GameItem, GameDownloadOption } from '../types';

const FITGIRL_BASE = 'https://fitgirl-repacks.site';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

export async function fetchFitGirlPopular(page: number = 1): Promise<GameItem[]> {
  try {
    const games: GameItem[] = [];

    if (page === 1) {
      // Try fetching pop-repacks page first for exact top 50 repacks on page 1
      const popRes = await axios.get(`${FITGIRL_BASE}/pop-repacks/`, { headers: DEFAULT_HEADERS, timeout: 12000 }).catch(() => null);
      if (popRes && popRes.data) {
        const $ = cheerio.load(popRes.data);
        $('.entry-content a').each((_, a) => {
          const href = $(a).attr('href') || '';
          const title = $(a).attr('title') || $(a).find('img').attr('alt') || '';
          const cover = $(a).find('img').attr('src') || '';

          if (href.startsWith('https://fitgirl-repacks.site/') && href !== 'https://fitgirl-repacks.site/pop-repacks/' && title) {
            const cleanId = `fg-${href.replace(/[^a-zA-Z0-9]/g, '')}`;
            const cleanTitle = title.replace(/^(?:Repack\s*:\s*|FitGirl\s*:\s*)/i, '').trim();

            if (!games.some(g => g.siteUrl === href)) {
              games.push({
                id: cleanId,
                title: cleanTitle,
                cover,
                size: 'Repack',
                repackSizeStr: 'Repack',
                repacker: 'FitGirl Repacks',
                siteBadge: 'FITGIRL',
                siteUrl: href,
                category: 'Lossless Repack',
                description: 'Click to load full game details, screenshots, and multi-part WebTorrent direct download mirrors.',
                releaseDate: new Date().toLocaleDateString(),
                screenshots: cover ? [cover] : [],
                downloads: []
              });
            }
          }
        });
      }

      if (games.length > 0) {
        const coverPromises = games.slice(0, 20).map(async (game) => {
          if (!game.cover && game.siteUrl) {
            try {
              const detailRes = await axios.get(game.siteUrl, { headers: DEFAULT_HEADERS, timeout: 6000 }).catch(() => null);
              if (detailRes && detailRes.data) {
                const $detail = cheerio.load(detailRes.data);
                const detailCover = $detail('.entry-content img').first().attr('src') || $detail('.entry-content img').first().attr('data-src') || '';
                if (detailCover) {
                  game.cover = detailCover;
                  game.screenshots = [detailCover];
                }
              }
            } catch {
              // ignore error
            }
          }
        });
        await Promise.allSettled(coverPromises);
        return games;
      }
    }

    // Page by page articles for page > 1 or fallback
    const targetUrl = page === 1 ? FITGIRL_BASE : `${FITGIRL_BASE}/page/${page}/`;
    const res = await axios.get(targetUrl, { headers: DEFAULT_HEADERS, timeout: 10000 }).catch(() => null);
    if (!res || !res.data) return games;

    const $ = cheerio.load(res.data);
    const articles = $('article.post');

    for (let i = 0; i < articles.length; i++) {
      const el = articles[i];
      const titleEl = $(el).find('.entry-title a');
      const title = titleEl.text().trim();
      const siteUrl = titleEl.attr('href');
      const cover = $(el).find('.entry-content img').first().attr('src') || '';

      if (!title || !siteUrl || title.toLowerCase().includes('digest') || title.toLowerCase().includes('upcoming repacks')) {
        continue;
      }

      const text = $(el).find('.entry-content').text();
      let repackSizeStr = '';
      let originalSizeStr = '';
      const repackMatch = text.match(/Repack Size:\s*(?:from\s*)?([0-9.]+\s*(?:GB|MB|TB))/i);
      const originalMatch = text.match(/Original Size:\s*([0-9.]+\s*(?:GB|MB|TB))/i);
      if (repackMatch) repackSizeStr = repackMatch[1];
      if (originalMatch) originalSizeStr = originalMatch[1];

      const cleanId = `fg-${siteUrl.replace(/[^a-zA-Z0-9]/g, '')}`;

      games.push({
        id: cleanId,
        title: title.replace(/^(?:Repack\s*:\s*|FitGirl\s*:\s*)/i, '').trim(),
        cover,
        size: repackSizeStr || originalSizeStr || 'Repack',
        repackSizeStr,
        originalSizeStr,
        repacker: 'FitGirl Repacks',
        siteBadge: 'FITGIRL',
        siteUrl,
        category: 'Lossless Repack',
        description: text.slice(0, 500) + '...',
        releaseDate: new Date().toLocaleDateString(),
        screenshots: cover ? [cover] : [],
        downloads: []
      });
    }

    return games;
  } catch (err) {
    console.error('Error fetching FitGirl popular feed:', err);
    return [];
  }
}

export async function searchFitGirl(query: string, page: number = 1): Promise<GameItem[]> {
  if (!query || !query.trim()) {
    return fetchFitGirlPopular(page);
  }

  try {
    const searchUrl = page === 1
      ? `${FITGIRL_BASE}/page/1/?s=${encodeURIComponent(query.trim())}`
      : `${FITGIRL_BASE}/page/${page}/?s=${encodeURIComponent(query.trim())}`;

    const res = await axios.get(searchUrl, { headers: DEFAULT_HEADERS, timeout: 12000 });
    const $ = cheerio.load(res.data);
    const games: GameItem[] = [];

    const articles = $('article');

    for (let i = 0; i < articles.length; i++) {
      const el = articles[i];
      const titleEl = $(el).find('.entry-title a');
      const title = titleEl.text().trim();
      const siteUrl = titleEl.attr('href');
      
      let cover = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';

      if (!title || !siteUrl || title.toLowerCase().includes('digest') || title.toLowerCase().includes('upcoming repacks')) {
        continue;
      }

      const text = $(el).find('.entry-summary, .entry-content').text();
      let repackSizeStr = '';
      let originalSizeStr = '';
      const repackMatch = text.match(/Repack Size:\s*(?:from\s*)?([0-9.]+\s*(?:GB|MB|TB))/i);
      const originalMatch = text.match(/Original Size:\s*([0-9.]+\s*(?:GB|MB|TB))/i);
      if (repackMatch) repackSizeStr = repackMatch[1];
      if (originalMatch) originalSizeStr = originalMatch[1];

      const cleanId = `fg-${siteUrl.replace(/[^a-zA-Z0-9]/g, '')}`;

      games.push({
        id: cleanId,
        title: title.replace(/^(?:Repack\s*:\s*|FitGirl\s*:\s*)/i, '').trim(),
        cover,
        size: repackSizeStr || originalSizeStr || 'Repack',
        repackSizeStr,
        originalSizeStr,
        repacker: 'FitGirl Repacks',
        siteBadge: 'FITGIRL',
        siteUrl,
        category: 'Lossless Repack',
        description: text.slice(0, 500) + '...',
        releaseDate: new Date().toLocaleDateString(),
        screenshots: cover ? [cover] : [],
        downloads: []
      });
    }

    const coverPromises = games.slice(0, 20).map(async (game) => {
      if (!game.cover && game.siteUrl) {
        try {
          const detailRes = await axios.get(game.siteUrl, { headers: DEFAULT_HEADERS, timeout: 6000 }).catch(() => null);
          if (detailRes && detailRes.data) {
            const $detail = cheerio.load(detailRes.data);
            const detailCover = $detail('.entry-content img').first().attr('src') || $detail('.entry-content img').first().attr('data-src') || '';
            if (detailCover) {
              game.cover = detailCover;
              game.screenshots = [detailCover];
            }
          }
        } catch {
          // ignore error
        }
      }
    });

    await Promise.allSettled(coverPromises);

    return games;
  } catch (err) {
    console.error('Error searching FitGirl:', err);
    return [];
  }
}

export async function fetchFitGirlGameDetails(siteUrl: string): Promise<{
  downloads: GameDownloadOption[];
  partsCount: number;
  description: string;
  repackSizeStr: string;
  originalSizeStr: string;
  cover: string;
  screenshots: string[];
}> {
  try {
    const res = await axios.get(siteUrl, { headers: DEFAULT_HEADERS, timeout: 12000 });
    const $ = cheerio.load(res.data);
    const downloads: GameDownloadOption[] = [];

    const cover = $('.entry-content img').first().attr('src') || '';
    const fullText = $('.entry-content').text();

    let repackSizeStr = '';
    let originalSizeStr = '';
    const repackMatch = fullText.match(/Repack Size:\s*(?:from\s*)?([0-9.]+\s*(?:GB|MB|TB))/i);
    const originalMatch = fullText.match(/Original Size:\s*([0-9.]+\s*(?:GB|MB|TB))/i);
    if (repackMatch) repackSizeStr = repackMatch[1];
    if (originalMatch) originalSizeStr = originalMatch[1];

    const screenshots: string[] = [];
    $('.entry-content img').each((i, img) => {
      const src = $(img).attr('src');
      if (src && i > 0 && screenshots.length < 4) {
        screenshots.push(src);
      }
    });

    const torrentUrls: string[] = [];
    
    // First try to find explicit .torrent file links
    $('.entry-content a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.endsWith('.torrent')) {
        const cleanHref = href.replace(/&#038;/g, '&').replace(/&amp;/g, '&');
        torrentUrls.push(cleanHref);
      }
    });

    const magnetUrls: string[] = [];
    const regexMatch = res.data.match(/magnet:\?xt=urn:btih:[^"'\s<>]+/gi);
    if (regexMatch) {
      regexMatch.forEach((match: string) => {
        if (match && match.startsWith('magnet:?')) {
          const cleanMagnet = match.replace(/&#038;/g, '&').replace(/&amp;/g, '&');
          magnetUrls.push(cleanMagnet);
        }
      });
    }

    $('.entry-content a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.startsWith('magnet:?')) {
        const cleanHref = href.replace(/&#038;/g, '&').replace(/&amp;/g, '&');
        magnetUrls.push(cleanHref);
      }
    });

    if (torrentUrls.length > 0) {
      downloads.push({
        type: 'direct',
        label: `Direct .torrent File`,
        url: torrentUrls[0],
        speedEstimate: 'High Speed Torrent'
      });
    } else if (magnetUrls.length > 0) {
      downloads.push({
        type: 'direct',
        label: `Torrent Download`,
        url: magnetUrls[0],
        speedEstimate: 'High Speed Torrent'
      });
    }

    const descParagraphs: string[] = [];
    $('.entry-content p').each((_, p) => {
      const t = $(p).text().trim();
      if (t && !t.startsWith('Download') && !t.startsWith('Repack Features') && descParagraphs.length < 5) {
        descParagraphs.push(t);
      }
    });

    return {
      downloads,
      partsCount: magnetUrls.length > 0 ? 1 : 0,
      description: descParagraphs.join('\n\n') || fullText.slice(0, 800),
      repackSizeStr,
      originalSizeStr,
      cover,
      screenshots
    };
  } catch (err) {
    console.error('Error fetching FitGirl game details:', err);
    return {
      downloads: [],
      partsCount: 0,
      description: '',
      repackSizeStr: '',
      originalSizeStr: '',
      cover: '',
      screenshots: []
    };
  }
}
