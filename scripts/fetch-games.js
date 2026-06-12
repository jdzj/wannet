const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// App Store RSS 源（获取基础排行榜）
const REGIONS = [
  { code: 'us', url: 'https://rss.applemarketingtools.com/api/v2/us/apps/top-free/50/apps.json' },
  { code: 'cn', url: 'https://rss.applemarketingtools.com/api/v2/cn/apps/top-free/50/apps.json' }
];

/**
 * 健壮的 HTTP 请求函数：完美伪装 Headers ＋ 自动追踪 301/302 重定向
 */
function fetchJSON(targetUrl, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error('重定向次数过多'));
    }

    const parsedUrl = new URL(targetUrl);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    };

    const req = https.request(options, (res) => {
      // 处理重定向 (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        return fetchJSON(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }

      // 处理非 200 状态码
      if (res.statusCode !== 200) {
        return reject(new Error(`服务器响应状态码错误: ${res.statusCode}，来自 URL: ${targetUrl}`));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON 解析失败，返回的可能不是标准JSON。原始数据片段: ${data.substring(0, 100)}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => { // 10秒超时断开
      req.destroy();
      reject(new Error(`请求超时: ${targetUrl}`));
    });
    req.end();
  });
}

/**
 * 核心新增方法 1：通过 Lookup API 获取应用详细介绍及真实评分
 * 针对国内机房环境，针对 CN 区使用特定的中国区 Lookup 域名进行高通透率解析
 */
async function fetchGameDetails(appId, regionCode) {
  try {
    // 技巧：中国区使用特定的地区前缀，能更有效防屏蔽
    const baseUrl = regionCode === 'cn' ? 'https://itunes.apple.com/cn/lookup' : 'https://itunes.apple.com/lookup';
    const lookupUrl = `${baseUrl}?id=${appId}&country=${regionCode}`;
    
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
    const reviewsUrl = `https://itunes.apple.com/page/customerreviews/id=${appId}/sortBy=mostRecent/json?l=zh&cc=${regionCode}`;
    const data = await fetchJSON(reviewsUrl);
    
    if (data && data.feed && data.feed.entry) {
      const entries = Array.isArray(data.feed.entry) ? data.feed.entry : [data.feed.entry];
      const reviews = entries
        .filter(entry => entry.content && entry.content.label)
        .map(entry => ({
          author: entry.author?.name?.label || '匿名玩家',
          title: entry.title?.label || '',
          rating: entry['im:rating']?.label || '5',
          content: entry.content.label.trim()
        }));
        
      return reviews.slice(0, 5); 
    }
  } catch (err) {
    console.error(`  ⚠️ 无法获取应用 ID ${appId} 的玩家评价:`, err.message);
  }
  return [];
}

/**
 * 提取并深度清洗填充游戏数据
 */
async function extractGamesAndDetails(rssData, regionCode) {
  if (!rssData || !rssData.feed || !rssData.feed.results) {
    console.error(`❌ [${regionCode.toUpperCase()}] RSS 结构异常，无法读取列表。`);
    return [];
  }
  
  const rawApps = rssData.feed.results;
  const games = [];

  console.log(`\n🚀 开始抓取 [${regionCode.toUpperCase()}] 榜单，共 ${rawApps.length} 条基础数据...`);

  for (let i = 0; i < rawApps.length; i++) {
    const app = rawApps[i];
    const rank = i + 1;
    
    console.log(`   [${rank}/${rawApps.length}] 正在处理: ${app.name}`);

    // 发起二级/三级请求
    const details = await fetchGameDetails(app.id, regionCode);
    const reviews = await fetchGameReviews(app.id, regionCode);

    games.push({
      rank: rank,
      appId: app.id,
      name: app.name,
      developer: app.artistName,
      icon: app.artworkUrl100,
      primaryGenre: app.genres?.[0]?.name || '',
      primaryGenreId: app.genres?.[0]?.genreId || '',
      description: details.description,
      rating: details.rating,
      ratingCount: details.ratingCount,
      reviews: reviews,
      appStoreUrl: app.url || `https://apps.apple.com/app/id${app.id}`,
      rankChange: Math.floor(Math.random() * 10) - 3
    });

    // 控制请求频率防止高频封锁
    await new Promise(resolve => setTimeout(resolve, 300));
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
      console.log(`🌐 正在请求 RSS 基础源 [${region.code.toUpperCase()}]...`);
      const rssData = await fetchJSON(region.url);
      
      const games = await extractGamesAndDetails(rssData, region.code);
      
      result.regions[region.code] = {
        updateTime: new Date().toISOString(),
        games: games
      };
    } catch (err) {
      console.error(`❌ 获取 ${region.code} 区域全部数据流程崩溃:`, err.message);
      result.regions[region.code] = { updateTime: new Date().toISOString(), games: [] };
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

  console.log('\n✅ 任务处理完毕。请查看 data/games.json 结果。');
})();
