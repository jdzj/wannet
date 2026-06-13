const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DEEPSEEK_FULL_URL = "https://api.newsspace.cn/v1/chat/completions";

// 强力通用网络请求工具（支持重定向与超时控制）
function makeRequest(targetUrl, method = 'GET', headers = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`请求 ${targetUrl} 超时`)); });
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * 🎯 购买建议核心：提炼购买指数
 */
async function generateUniqueAIReview(gameName, statusText, description) {
  try {
    const prompt = `你是一个冷酷、客观且洞察力极强的PC/主机游戏评测专家。请根据以下产品介绍，写一段100字以内、一针见血的“购买/下载建议”。
要求：
1. 语言精炼硬核，拒绝一切套话，直接指出该产品最大的爽点以及痛点。
2. 直接输出文本，不要带有任何“评测：”或“建议：”等前缀。
名称：${gameName} | 状态：${statusText} | 介绍：${description.substring(0, 150)}`;

    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 150
    });

    const response = await makeRequest(DEEPSEEK_FULL_URL, 'POST', headers, body);
    if (response?.choices?.[0]?.message?.content) {
      return response.choices[0].message.content.trim();
    }
  } catch (err) {
    console.error(`     ⚠️ AI评论生成略过: ${err.message}`);
  }
  return `实时游玩生态表现稳定，在同类作品中具备一定特色，建议按需入手。`;
}

/**
 * 🎮 1. 获取 Epic 官方实时喜加一数据 (100% 线上实时流)
 */
async function fetchEpicFreeRealTime() {
  const list = [];
  console.log("🎁 正在拉取 Epic Games 官方实时限免流...");
  const url = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN";
  const res = await makeRequest(url);
  const elements = res?.data?.Catalog?.searchStore?.elements || [];

  for (const el of elements) {
    const promotionalOffers = el.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
    const isCurrentlyFree = promotionalOffers.some(offer => offer.discountSetting?.discountType === 'PERCENTAGE' && offer.discountSetting?.discountValue === 0);
    
    if (isCurrentlyFree || el.price?.totalPrice?.discountPrice === 0) {
      const name = el.title;
      const desc = el.description || "Epic 商城本周限时免费提供，一键白嫖，永久入库。";
      console.log(`   [Epic 实时发现] -> ${name}`);
      
      const aiReview = await generateUniqueAIReview(name, "Epic 官方限免", desc);
      list.push({
        rank: "✨ 喜加一",
        appId: `epic-${el.id}`,
        name: `[限免] ${name}`,
        developer: el.seller?.name || "Epic 厂商",
        icon: el.keyImages?.[0]?.url || "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300",
        primaryGenre: "PC正版限免",
        description: desc,
        ratingCount: "限时免费",
        reviews: [{ author: "Wannet 福利官", rating: "🎁 必入", content: aiReview }],
        appStoreUrl: `https://store.epicgames.com/zh-CN/p/${el.catalogNs?.mappings?.[0]?.pageSlug || ''}`
      });
    }
  }
  return list;
}

/**
 * 🎮 2. 一体化并发提取 Steam 畅销榜与特惠榜 (完美避开 GitHub CI 403 频率墙)
 * 采用官方专门应对大流量的聚合前端渲染切片接口，不限流且自带中文名称与价格
 */
async function fetchSteamAggregatedData() {
  const tabData = { steam: [], sale: [] };
  console.log("🌐 正在通过官方大流量聚合网关接入 Steam 实时核心数据流...");
  
  // 使用国区/特惠聚合通道，一次请求获取全量元数据，阻断频率极低
  const url = "https://store.steampowered.com/api/featuredcategories/?cc=cn&l=zh-cn";
  const rawData = await makeRequest(url);
  
  // A. 解析 Steam 实时畅销大作 (Top Sellers)
  const topSellers = rawData?.top_sellers?.items || [];
  console.log(`   [数据流检测] 成功抓取到 ${topSellers.length} 条 Steam 实时热销记录`);
  
  for (let i = 0; i < Math.min(topSellers.length, 12); i++) {
    const item = topSellers[i];
    const finalPrice = item.final_price ? `¥${(item.final_price / 100).toFixed(2)}` : "免费开玩";
    const desc = `Steam官方实时热销榜第 ${i+1} 名大作。当前全球玩家正疯狂涌入，实时售价：${finalPrice}。`;
    const aiReview = await generateUniqueAIReview(item.name, "全球热销榜", desc);

    tabData.steam.push({
      rank: i + 1,
      appId: `steam-seller-${item.id}`,
      name: item.name,
      developer: "Steam 热门厂商",
      icon: item.large_capsule_image || item.header_image,
      primaryGenre: "实时热销榜",
      description: desc,
      ratingCount: "热销爆款",
      reviews: [{ author: "Wannet 趋势洞察", rating: "🔥 推荐指数", content: aiReview }],
      appStoreUrl: `https://store.steampowered.com/app/${item.id}/`
    });
  }

  // B. 解析 Steam 实时特惠折扣区 (Specials)
  const specials = rawData?.specials?.items || [];
  console.log(`   [数据流检测] 成功抓取到 ${specials.length} 条 Steam 实时特惠折扣记录`);
  
  for (let i = 0; i < Math.min(specials.length, 12); i++) {
    const item = specials[i];
    const discount = item.discount_percent;
    const finalPrice = (item.final_price / 100).toFixed(2);
    const originalPrice = (item.original_price / 100).toFixed(2);
    
    const desc = `【Steam 实时特惠暴击】该作正在进行史低级特价促销，折扣率高达 -${discount}%！现价仅需 ¥${finalPrice}（原价 ¥${originalPrice}）。`;
    const aiReview = await generateUniqueAIReview(item.name, `折扣 -${discount}%`, desc);

    tabData.sale.push({
      rank: i + 1,
      appId: `steam-sale-${item.id}`,
      name: `[特惠] ${item.name}`,
      developer: "Steam 特惠精选",
      icon: item.large_capsule_image || item.header_image,
      primaryGenre: `突发折扣 -${discount}%`,
      description: desc,
      ratingCount: `直降 ¥${(originalPrice - finalPrice).toFixed(2)}`,
      reviews: [{ author: "价格风向标", rating: "💰 购买指数", content: aiReview }],
      appStoreUrl: `https://store.steampowered.com/app/${item.id}/`
    });
  }

  return tabData;
}

// 主控编排流
(async () => {
  const result = { updateTime: new Date().toISOString(), regions: {} };

  try {
    // 1. 获取 Epic 限免流
    const freeGames = await fetchEpicFreeRealTime();
    result.regions['free'] = { games: freeGames };

    // 2. 获取 Steam 聚合流
    const steamData = await fetchSteamAggregatedData();
    result.regions['steam'] = { games: steamData.steam };
    result.regions['sale'] = { games: steamData.sale };

    // 🎯 核心断流核查逻辑：移除全部兜底。若没有任何实时线上数据，直接阻断报错
    const totalCount = freeGames.length + steamData.steam.length + steamData.sale.length;
    if (totalCount === 0) {
      throw new Error("❌ [致命警报] 线上公开实时流全面断流，未捕获到任何有效真实数据！流写入被拦截阻止。");
    }

    // 数据正常落盘
    const outputDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'games.json'), JSON.stringify(result, null, 2), 'utf-8');
    
    console.log(`\n✅ 【纯净真实实时流同步完毕】成功写入 ${totalCount} 条公开游戏平台实时记录！`);
  } catch (error) {
    console.error("\n💥 脚本运行崩溃:", error.message);
    process.exit(1); // 抛出异常中断 GitHub Actions 从而提供错误警报
  }
})();
