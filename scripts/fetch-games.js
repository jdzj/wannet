const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DEEPSEEK_FULL_URL = "https://api.newsspace.cn/v1/chat/completions";

// 通用网络请求工具
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
 * 🎯 AI 看盘诊断评测
 */
async function generateUniqueAIReview(gameName, statusText, description) {
  try {
    const prompt = `你是一个冷酷、客观且洞察力极强的PC/主机游戏评测专家。请根据以下产品介绍，写一段100字以内、一针见血的“购买/下载建议”。
要求：语言精炼硬核，拒绝一切套话，直接指出该产品最大的爽点以及痛点。直接输出文本，不要带有任何前缀。
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
  } catch (err) {}
  return `核心玩法在同类作品中素质过硬，目前价格机制性价比良好，建议按需入手。`;
}

/**
 * 🔍 深度穿透：获取 Steam 游戏详情与限免入库状态 (is_free_to_keep)
 */
async function fetchSteamGameDescription(appId, fallbackName) {
  try {
    const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=cn&l=zh-cn`;
    const res = await makeRequest(detailUrl);
    if (res?.[appId]?.success && res[appId].data) {
      const data = res[appId].data;
      return {
        description: data.short_description || data.about_the_game || "暂无官方详细中文简介。",
        developer: data.developers?.[0] || "Steam精品厂商",
        genre: data.genres?.[0]?.description || "PC游戏",
        isFreeToKeep: data.price_overview?.discount_percent === 100 || data.is_free === true // 拦截 100% 折扣的限时免费游戏
      };
    }
  } catch (e) {}
  return {
    description: `【Wannet 实时流】收录于 Steam 核心数据库的高热度作品《${fallbackName}》。具备极高社区讨论度。`,
    developer: "Steam 精选厂商",
    genre: "热门大作",
    isFreeToKeep: false
  };
}

/**
 * 🎁 1. 聚合 Epic 与 Steam 的【真·限时免费领取】游戏
 */
async function fetchAggregatedFreeGames(steamSpecialsAndSellers) {
  const freeList = [];
  
  // A. 抓取 Epic 实时限免
  try {
    console.log("🎁 正在拉取 Epic Games 官方实时限免流...");
    const url = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN";
    const res = await makeRequest(url);
    const elements = res?.data?.Catalog?.searchStore?.elements || [];

    for (const el of elements) {
      const promotionalOffers = el.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
      const isCurrentlyFree = promotionalOffers.some(offer => offer.discountSetting?.discountType === 'PERCENTAGE' && offer.discountSetting?.discountValue === 0);
      
      if (isCurrentlyFree || el.price?.totalPrice?.discountPrice === 0) {
        const name = el.title;
        const desc = el.description || "Epic 商城本周官方限时免费提供大作，一键白嫖，永久入库。";
        const aiReview = await generateUniqueAIReview(name, "Epic 官方限免", desc);
        freeList.push({
          rank: "Epic 限免",
          appId: `epic-${el.id}`,
          name: `[Epic] ${name}`,
          developer: el.seller?.name || "Epic 合作商",
          icon: el.keyImages?.[0]?.url || "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300",
          primaryGenre: "正版限时免费",
          description: desc,
          ratingCount: "0元入库",
          reviews: [{ author: "Wannet 福利官", rating: "🎁 必入", content: aiReview }],
          appStoreUrl: `https://store.epicgames.com/zh-CN/p/${el.catalogNs?.mappings?.[0]?.pageSlug || ''}`
        });
      }
    }
  } catch (e) { console.error("⚠️ Epic 限免流解析延迟。"); }

  // B. 动态穿透检测：筛选 Steam 突发的 100% 折扣限免游戏（即限时免费领取的商业大作）
  try {
    for (const item of steamSpecialsAndSellers) {
      if (item.isFreeToKeep) {
        console.log(`🔥 [惊喜发现] 检测到 Steam 平台突发限免大作 -> ${item.name}`);
        const aiReview = await generateUniqueAIReview(item.name, "Steam 限时特免", item.description);
        freeList.push({
          rank: "Steam 限免",
          appId: `steam-free-${item.appId}`,
          name: `[Steam] ${item.name}`,
          developer: item.developer,
          icon: item.icon,
          primaryGenre: "Steam限时特免",
          description: `【Steam 喜加一特报】该作目前处于官方 100% 满额折扣促销期，限时免费领取，一键入库永久保留！\n官方简介：${item.description}`,
          ratingCount: "限时 0 元",
          reviews: [{ author: "Wannet 福利官", rating: "🔥 瞬间抢购", content: aiReview }],
          appStoreUrl: item.appStoreUrl
        });
      }
    }
  } catch (e) {}

  return freeList;
}

/**
 * 🎮 2. 获取 Steam 畅销榜与特惠区
 */
async function fetchSteamMainData() {
  const tabData = { steam: [], sale: [], rawItems: [] };
  console.log("🌐 正在对接 Valve 官方高载荷数据中心...");
  
  const url = "https://store.steampowered.com/api/featuredcategories/?cc=cn&l=zh-cn";
  const rawData = await makeRequest(url);
  
  const topSellers = rawData?.top_sellers?.items || [];
  for (let i = 0; i < Math.min(topSellers.length, 10); i++) {
    const item = topSellers[i];
    const meta = await fetchSteamGameDescription(item.id, item.name);
    const aiReview = await generateUniqueAIReview(item.name, "全球热销榜", meta.description);

    const fullItem = {
      rank: i + 1,
      appId: `steam-seller-${item.id}`,
      name: item.name,
      developer: meta.developer,
      icon: item.large_capsule_image || item.header_image,
      primaryGenre: meta.genre,
      description: meta.description,
      ratingCount: "热销爆款",
      reviews: [{ author: "Wannet 趋势洞察", rating: "🔥 推荐指数", content: aiReview }],
      appStoreUrl: `https://store.steampowered.com/app/${item.id}/`,
      isFreeToKeep: meta.isFreeToKeep
    };
    tabData.steam.push(fullItem);
    tabData.rawItems.push(fullItem);
    await new Promise(r => setTimeout(r, 200));
  }

  const specials = rawData?.specials?.items || [];
  for (let i = 0; i < Math.min(specials.length, 10); i++) {
    const item = specials[i];
    const discount = item.discount_percent;
    const finalPrice = (item.final_price / 100).toFixed(2);
    const originalPrice = (item.original_price / 100).toFixed(2);
    
    const meta = await fetchSteamGameDescription(item.id, item.name);
    const fullDesc = `【实时特惠折扣 -${discount}%】原价 ¥${originalPrice}，当前促销现价仅需 ¥${finalPrice}！\n官方简介：${meta.description}`;
    const aiReview = await generateUniqueAIReview(item.name, `折扣 -${discount}%`, meta.description);

    const fullItem = {
      rank: i + 1,
      appId: `steam-sale-${item.id}`,
      name: `[特惠] ${item.name}`,
      developer: meta.developer,
      icon: item.large_capsule_image || item.header_image,
      primaryGenre: `折扣 -${discount}%`,
      description: fullDesc,
      ratingCount: `直降 ¥${(originalPrice - finalPrice).toFixed(2)}`,
      reviews: [{ author: "价格风向标", rating: "💰 购买指数", content: aiReview }],
      appStoreUrl: `https://store.steampowered.com/app/${item.id}/`,
      isFreeToKeep: meta.isFreeToKeep
    };
    tabData.sale.push(fullItem);
    tabData.rawItems.push(fullItem);
    await new Promise(r => setTimeout(r, 200));
  }

  return tabData;
}

/**
 * 🕹️ 3. 实时对接全球最大的独立游戏开放平台 —— Itch.io 促销流
 */
async function fetchItchioIndependentSales() {
  const list = [];
  try {
    console.log("🔮 正在连线 Itch.io 全球独立游戏核心开放流获取促销精品...");
    // 抓取 itch.io 实时高热度折扣游戏流
    const url = "https://itch.io/games/on-sale.json";
    const res = await makeRequest(url);
    const games = res?.games || [];

    for (let i = 0; i < Math.min(games.length, 10); i++) {
      const g = games[i];
      const name = g.title;
      const desc = g.short_text || "充满极高创意与独立精神的神作，玩法机制独特，极具艺术发掘价值。";
      const priceText = g.price || "特惠促销中";
      console.log(`   [Itch.io 独立游发现] -> ${name}`);

      const aiReview = await generateUniqueAIReview(name, "独立精品促销", desc);
      list.push({
        rank: `独立精选`,
        appId: `itch-${g.id}`,
        name: `[独立] ${name}`,
        developer: g.user?.username || "独立极客工作室",
        icon: g.cover_url || "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300",
        primaryGenre: "Itch.io 独立游戏",
        description: `【Itch.io 独立特惠】售价：${priceText}。\n独立游戏简介：${desc}`,
        ratingCount: "创意爆表",
        reviews: [{ author: "Wannet 独立游戏人", rating: "🎨 艺术评级", content: aiReview }],
        appStoreUrl: g.url || "https://itch.io"
      });
    }
  } catch (e) {
    console.error("⚠️ Itch.io 独立游戏流链接抖动，跳过防止阻断。");
  }
  return list;
}

// 主控编排
(async () => {
  const result = { updateTime: new Date().toISOString(), regions: {} };

  try {
    // 1. 获取 Steam 骨干流
    const steamMain = await fetchSteamMainData();
    result.regions['steam'] = { games: steamMain.steam };
    result.regions['sale'] = { games: steamMain.sale };

    // 2. 混合聚合流：将 Epic 与 Steam 解析到的 isFreeToKeep 特免游戏全部并入 free 板块
    const aggregatedFree = await fetchAggregatedFreeGames(steamMain.rawItems);
    result.regions['free'] = { games: aggregatedFree };

    // 3. 获取 Itch.io 实时独立游戏流
    const itchGames = await fetchItchioIndependentSales();
    result.regions['itch'] = { games: itchGames };

    // 阻断核查
    const total = aggregatedFree.length + steamMain.steam.length + steamMain.sale.length + itchGames.length;
    if (total === 0) throw new Error("❌ 公开平台流全线断开！拦截空数据落盘。");

    const outputDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'games.json'), JSON.stringify(result, null, 2), 'utf-8');
    
    console.log(`\n✅ 【多流联控同步完毕】成功写入 ${total} 条全平台合并实时记录！`);
  } catch (error) {
    console.error("\n💥 脚本运行崩溃:", error.message);
    process.exit(1);
  }
})();
