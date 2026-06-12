const https = require('https');
const fs = require('fs');
const path = require('path');

// App Store RSS 源（获取基础排行榜）
const REGIONS = [
  { code: 'us', url: 'https://rss.applemarketingtools.com/api/v2/us/apps/top-free/50/apps.json' },
  { code: 'cn', url: 'https://rss.applemarketingtools.com/api/v2/cn/apps/top-free/50/apps.json' }
];

// 封装 HTTPS GET 请求的辅助函数
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    // 增加 User-Agent 伪装，防止被部分接口拦截
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    https.get(url, options, (res) => {
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

/**
 * 核心新增方法 1：通过 Lookup API 获取应用详细介绍及真实评分
 */
async function fetchGameDetails(appId, regionCode) {
  try {
    const lookupUrl = `https://itunes.apple.com/lookup?id=${appId}&country=${regionCode}`;
    const data = await fetchJSON(lookupUrl);
    if (data && data.results && data.results.length > 0) {
      const detail = data.results[0];
      return {
        description: detail.description || '暂无介绍',
        rating: detail.averageUserRating ? detail.averageUserRating.toFixed(1) : '0.0',
        ratingCount: detail.userRatingCount || 0
      };
    }
  } catch (err) {
    console.error(`  ⚠️ 无法获取应用 ID ${appId} 的详细信息:`, err.message);
  }
  return { description: '暂无介绍', rating: '0.0', ratingCount: 0 };
}

/**
 * 核心新增方法 2：通过 Customer Reviews API 获取真实的玩家评论文本
 */
async function fetchGameReviews(appId, regionCode) {
  try {
    // 限制获取最新评论（通常返回近期约 50-100 条）
    const reviewsUrl = `https://itunes.apple.com/page/customerreviews/id=${appId}/sortBy=mostRecent/json?l=zh&cc=${regionCode}`;
    const data = await fetchJSON(reviewsUrl);
    
    if (data && data.feed && data.feed.entry) {
      // 过滤并提取评论文本（排除第一条，第一条通常是应用的元数据信息）
      const entries = Array.isArray(data.feed.entry) ? data.feed.entry : [data.feed.entry];
      
      const reviews = entries
        .filter(entry => entry.content && entry.content.label)
        .map(entry => ({
          author: entry.author?.name?.label || '匿名玩家',
          title: entry.title?.label || '',
          rating: entry['im:rating']?.label || '5',
          content: entry.content.label.trim()
        }));
        
      // 默认只保留最新的 5 条具体评价，避免 games.json 文件体积过大
      return reviews.slice(0, 5); 
    }
  } catch (err) {
    // 有些新游戏或小众游戏可能没有评论，接口会报错，这里容错处理
    console.error(`  ⚠️ 无法获取应用 ID ${appId} 的玩家评价:`, err.message);
  }
  return [];
}

/**
 * 提取并深度清洗填充游戏数据
 */
async function extractGamesAndDetails(rssData, regionCode) {
  if (!rssData.feed || !rssData.feed.results) return [];
  const rawApps = rssData.feed.results;
  const games = [];

  console.log(`\n🚀 开始深度抓取 [${regionCode.toUpperCase()}] 榜单数据的详细信息与评价...`);

  for (let i = 0; i < rawApps.length; i++) {
    const app = rawApps[i];
    const rank = i + 1;
    
    console.log(`[${rank}/${rawApps.length}] 正在处理: ${app.name}`);

    // 1. 发起二级请求：获取真实的游戏介绍和评分
    const details = await fetchGameDetails(app.id, regionCode);

    // 2. 发起三级请求：获取真实的玩家评论
    const reviews = await fetchGameReviews(app.id, regionCode);

    // 3. 组装最终完整的数据结构
    games.push({
      rank: rank,
      appId: app.id,
      name: app.name,
      developer: app.artistName,
      icon: app.artworkUrl100,
      primaryGenre: app.genres?.[0]?.name || '',
      primaryGenreId: app.genres?.[0]?.genreId || '',
      description: details.description,       // 真实游戏介绍
      rating: details.rating,                 // 真实平均评分
      ratingCount: details.ratingCount,       // 真实评分数
      reviews: reviews,                       // 真实玩家评价列表 (Array)
      appStoreUrl: app.url || `https://apps.apple.com/app/id${app.id}`,
      rankChange: Math.floor(Math.random() * 10) - 3 // 榜单暂无涨跌字段，保留模拟
    });

    // 适当控制请求频率，避免被苹果服务器短暂封 IP (每爬完一个应用歇 200毫秒)
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return games;
}

// 主运行函数
(async () => {
  const result = {
    updateTime: new Date().toISOString(),
    regions: {}
  };

  for (const region of REGIONS) {
    try {
      const rssData = await fetchJSON(region.url);
      // 深度提取包含介绍和评价的数据
      const games = await extractGamesAndDetails(rssData, region.code);
      
      result.regions[region.code] = {
        updateTime: new Date().toISOString(),
        games: games
      };
    } catch (err) {
      console.error(`❌ 获取 ${region.code} 区域榜单失败:`, err.message);
      result.regions[region.code] = { games: [] };
    }
  }

  // 确保 data 文件夹存在
  const outputDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 写入最终生成的 games.json
  fs.writeFileSync(
    path.join(outputDir, 'games.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  );

  console.log('\n✅ 所有真实数据已成功写入并更新至 data/games.json！');
})();
