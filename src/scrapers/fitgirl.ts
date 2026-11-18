import axios from 'axios';
import * as cheerio from 'cheerio';
import { GameItem, GameDownloadOption } from '../types';

// Use only FitGirl's canonical site. fitgirl.ru is a different, unrelated shop.
const FITGIRL_BASE = 'https://fitgirl-repacks.site';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

// Fail clearly when the canonical source is unavailable; never substitute a lookalike domain.
async function robustGet(path: string, timeout = 14000): Promise<any> {
  const url = new URL(path, FITGIRL_BASE);
  if (url.protocol !== 'https:' || url.hostname !== 'fitgirl-repacks.site') {
    throw new Error('Refusing a non-canonical FitGirl URL.');
  }
  try {
    const res = await axios.get(url.toString(), { headers: DEFAULT_HEADERS, timeout });
    if (res?.data) return res;
    throw new Error('The FitGirl page was empty.');
  } catch (error: any) {
    throw new Error(`Could not reach FitGirl Repacks (${error.code || error.response?.status || error.message}).`);
  }
}

function canonicalGameUrl(href: string): string | null {
  try {
    const url = new URL(href, FITGIRL_BASE);
    return url.protocol === 'https:' && url.hostname === 'fitgirl-repacks.site' ? url.toString() : null;
  } catch { return null; }
}

export async function fetchFitGirlPopular(page: number = 1): Promise<GameItem[]> {
  try {
    const games: GameItem[] = [];

    if (page === 1) {
      let popRes: any = null;
      try { popRes = await robustGet('/pop-repacks/'); }
      catch (error: any) { console.warn('[FitGirl] Popular page unavailable; trying the official homepage:', error.message); }
      if (popRes && popRes.data) {
        const $ = cheerio.load(popRes.data);
        $('.entry-content a').each((_, a) => {
          const href = canonicalGameUrl($(a).attr('href') || '');
          if (!href) return;
          const title = $(a).attr('title') || $(a).find('img').attr('alt') || '';
          const cover = $(a).find('img').attr('src') || '';

          if (title) {
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
                description: 'Click to load full game details and torrent download.',
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
              const detailRes = await robustGet(game.siteUrl, 6000);
              if (detailRes && detailRes.data) {
                const $detail = cheerio.load(detailRes.data);
                const detailCover = $detail('.entry-content img').first().attr('src') || '';
                if (detailCover) {
                  game.cover = detailCover;
                  game.screenshots = [detailCover];
                }
              }
            } catch { /* ignore */ }
          }
        });
        await Promise.allSettled(coverPromises);
        return games;
      }
    }

    // Page-by-page fallback
    const targetPath = page === 1 ? '/' : `/page/${page}/`;
    const res = await robustGet(targetPath);
    if (!res || !res.data) throw new Error('The official FitGirl homepage returned no content.');

    const $ = cheerio.load(res.data);
    const articles = $('article.post');

    for (let i = 0; i < articles.length; i++) {
      const el = articles[i];
      const titleEl = $(el).find('.entry-title a');
      const title = titleEl.text().trim();
      const siteUrl = canonicalGameUrl(titleEl.attr('href') || '');
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

    if (!games.length) throw new Error('FitGirl responded, but its game list could not be read. The site layout may have changed.');
    return games;
  } catch (err) {
    console.error('Error fetching FitGirl popular feed:', err);
    throw err;
  }
}

export async function searchFitGirl(query: string, page: number = 1): Promise<GameItem[]> {
  if (!query || !query.trim()) {
    return fetchFitGirlPopular(page);
  }

  try {
    const searchPath = page === 1
      ? `/?s=${encodeURIComponent(query.trim())}`
      : `/page/${page}/?s=${encodeURIComponent(query.trim())}`;
    const res = await robustGet(searchPath);
    if (!res || !res.data) return [];

    const $ = cheerio.load(res.data);
    const games: GameItem[] = [];

    const articles = $('article');

    for (let i = 0; i < articles.length; i++) {
      const el = articles[i];
      const titleEl = $(el).find('.entry-title a');
      const title = titleEl.text().trim();
      const siteUrl = canonicalGameUrl(titleEl.attr('href') || '');
      
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
          const detailRes = await robustGet(game.siteUrl, 6000);
          if (detailRes && detailRes.data) {
            const $detail = cheerio.load(detailRes.data);
            const detailCover = $detail('.entry-content img').first().attr('src') || '';
            if (detailCover) {
              game.cover = detailCover;
              game.screenshots = [detailCover];
            }
          }
        } catch { /* ignore */ }
      }
    });

    await Promise.allSettled(coverPromises);
    return games;
  } catch (err) {
    console.error('Error searching FitGirl:', err);
    throw err;
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
    const res = await robustGet(siteUrl, 15000);
    if (!res || !res.data) {
      return { downloads: [], partsCount: 0, description: 'Could not load game page. Check your connection.', repackSizeStr: '', originalSizeStr: '', cover: '', screenshots: [] };
    }

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