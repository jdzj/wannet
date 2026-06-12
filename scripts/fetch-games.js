const https = require('https');
const fs = require('fs');
const path = require('path');

// App Store RSS 源，可自行调整国家代码（cn=中国，us=美国）
const REGIONS = [
  { code: 'us', url: 'https://rss.applemarketingtools.com/api/v2/us/apps/top-free/50/apps.json' },
  { code: 'cn', url: 'https://rss.applemarketingtools.com/api/v2/cn/apps/top-free/50/apps.json' }
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function extractGames(data) {
  if (!data.feed || !data.feed.results) return [];
  return data.feed.results.map((app, index) => ({
    rank: index + 1,
    appId: app.id,
    name: app.name,
    developer: app.artistName,
    icon: app.artworkUrl100,
    primaryGenre: app.genres?.[0]?.name || '',
    primaryGenreId: app.genres?.[0]?.name || '',
    rating: app.contentAdvisoryRating === '4+' ? (Math.random() * 2 + 3).toFixed(1) : (Math.random() * 2 + 2).toFixed(1), // 模拟评分，实际RSS不提供
    ratingCount: Math.floor(Math.random() * 50000) + 100, // 模拟评分数
    appStoreUrl: app.url || `https://apps.apple.com/app/id${app.id}`,
    rankChange: Math.floor(Math.random() * 10) - 3 // 模拟排名变化
  }));
}

(async () => {
  const result = {
    updateTime: new Date().toISOString(),
    regions: {}
  };

  for (const region of REGIONS) {
    try {
      const data = await fetchJSON(region.url);
      const games = extractGames(data);
      // 过滤掉非游戏类（可选），这里简单保留所有
      result.regions[region.code] = {
        updateTime: new Date().toISOString(),
        games: games
      };
    } catch (err) {
      console.error(`Failed to fetch ${region.code}:`, err.message);
      result.regions[region.code] = { games: [] };
    }
  }

  const outputDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(outputDir, 'games.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  );
  console.log('✅ games.json updated');
})();
