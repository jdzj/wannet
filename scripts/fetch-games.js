const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DEEPSEEK_FULL_URL = "https://api.newsspace.cn/v1/chat/completions";

// 🛡️ 终极防御网络请求工具
function makeRequest(targetUrl, method = 'GET', headers = {}, postData = null) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(targetUrl);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...headers
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { 
          if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
            resolve(JSON.parse(data)); 
          } else {
            resolve(data); // XML/RSS 文本流直接返回
          }
        } catch (e) { 
          resolve(data); 
        }
      });
    });
    
    req.on('error', (err) => {
      console.error(`      ⚠️ [网络警告] 请求 ${targetUrl} 失败: ${err.message}`);
      resolve(null);
    });
    
    req.setTimeout(12000, () => { 
      req.destroy(); 
      resolve(null); 
    });
    
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * 📊 穿透获取 Steam 实时在线人数
 */
async function fetchSteamOnlinePlayers(appId) {
  try {
    const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`;
    const res = await makeRequest(url);
    if (res?.response?.result === 1) {
      return res.response.player_count;
    }
  } catch (e) {}
  return null;
}

/**
 * 🧠 多源百科与大模型自愈合并流
 */
async function generateDeepFullDescription(gameName, rawShortDesc, onlinePlayers = null) {
  const playerText = onlinePlayers ? `【当前Steam实时在线人数】：${onlinePlayers.toLocaleString()} 人\n` : '';
  const fallbackText = `${playerText}📖【游戏剧情与背景】\n暂无详细背景剧情介绍。\n\n🎮【核心玩法介绍】\n${rawShortDesc || '暂无核心玩法细节。'}\n\n🏰【关卡与特色系统】\n探索与实时系统表现稳定。`;

  try {
    const prompt = `你是一个融合了百度百科、Steam商店以及专业游戏评测媒体的数据合成专家。
请为游戏《${gameName}》生成一份多维度的全景中文介绍。
已知碎片信息：${rawShortDesc || '无'}

请严格按照以下结构输出，如果没有官方准确数据，请根据百度百科等公开网络常识进行逻辑推导和内容丰富：

📖【游戏剧情与背景】
(介绍游戏的故事背景、玩家扮演的角色、核心冲突或世界观，字数约80字)

🎮【核心玩法介绍】
(说明游戏的分类视角、主要操作逻辑、战斗或解谜的核心循环，字数约80字)

🏰【关卡与特色系统】
(介绍游戏内的关卡结构、地图设计、天赋/装备/养成等特色系统，字数约80字)

请直接输出内容，每部分中间用换行隔开，不要包含“根据已知信息”等废话。`;

    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      max_tokens: 600
    });

    const response = await makeRequest(DEEPSEEK_FULL_URL, 'POST', headers, body);
    if (response?.choices?.[0]?.message?.content) {
      return playerText + response.choices[0].message.content.trim();
    }
  } catch (err) {
    console.error(`     ⚠️ AI全景生成受阻: ${err.message}`);
  }
  return fallbackText;
}

/**
 * 🎯 AI 购买建议生成器
 */
async function generateUniqueAIReview(gameName, statusText, fullDescription) {
  try {
    const prompt = `你是一个冷酷、客观且洞察力极强的PC/主机游戏评测专家。请根据以下产品多维度全景介绍，写一段100字以内、一针见血的“购买/下载建议”。
要求：语言精炼硬核，直击痛点与爽点，拒绝套话，不要带有前缀。
名称：${gameName} | 状态：${statusText} | 详情：${fullDescription.substring(0, 200)}`;

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
  return `玩法机制素质过硬，目前版本游玩生态稳定，建议按需入手。`;
}

/**
 * 🔍 深度穿透：解析 Steam 游戏详情
 */
async function fetchSteamGameDescription(appId, fallbackName) {
  let onlinePlayers = await fetchSteamOnlinePlayers(appId);
  try {
    const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=cn&l=zh-cn`;
    const res = await makeRequest(detailUrl);
    if (res?.[appId]?.success && res[appId].data) {
      const data = res[appId].data;
      const rawShort = data.short_description || data.about_the_game || "";
      const fullRichDescription = await generateDeepFullDescription(fallbackName, rawShort, onlinePlayers);

      return {
        description: fullRichDescription,
        developer: data.developers?.[0] || "Steam精品厂商",
        genre: data.genres?.[0]?.description || "PC游戏",
        isFreeToKeep: data.price_overview?.discount_percent === 100 || data.is_free === true
      };
    }
  } catch (e) {}

  const fallbackRich = await generateDeepFullDescription(fallbackName, "元数据暂时缺失", onlinePlayers);
  return {
    description: fallbackRich,
    developer: "Steam 精选厂商",
    genre: "热门大作",
    isFreeToKeep: false
  };
}

/**
 * 🎁 1. 聚合 Epic 与 Steam 的限免游戏
 */
async function fetchAggregatedFreeGames(steamSpecialsAndSellers) {
  const freeList = [];
  
  // A. Epic 实时限免
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
        const baseDesc = el.description || "";
        const fullRichDesc = await generateDeepFullDescription(name, baseDesc);
        const aiReview = await generateUniqueAIReview(name, "Epic 官方限免", fullRichDesc);
        
        freeList.push({
          rank: "Epic 限免",
          appId: `epic-${el.id}`,
          name: `[Epic] ${name}`,
          developer: el.seller?.name || "Epic 合作商",
          icon: el.keyImages?.[0]?.url || "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300",
          primaryGenre: "正版限时免费",
          description: fullRichDesc,
          ratingCount: "0元入库",
          reviews: [{ author: "Wannet 福利官", rating: "🎁 必入", content: aiReview }],
          appStoreUrl: `https://store.epicgames.com/zh-CN/p/${el.catalogNs?.mappings?.[0]?.pageSlug || ''}`
        });
      }
    }
  } catch (e) { console.error("⚠️ Epic 限免流解析延迟。"); }

  // B. Steam 限时特免
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
          description: `【Steam 喜加一特报】该作目前处于官方 100% 满额折扣促销期，限时免费领取，一键入库永久保留！\n\n${item.description}`,
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
  console.log("🌐 正在对接 Valve 官方数据网关...");
  
  const url = "https://store.steampowered.com/api/featuredcategories/?cc=cn&l=zh-cn";
  const rawData = await makeRequest(url);
  
  const topSellers = rawData?.top_sellers?.items || [];
  for (let i = 0; i < Math.min(topSellers.length, 5); i++) {
    const item = topSellers[i];
    const meta = await fetchSteamGameDescription(item.id, item.name);
    console.log(`      -> [全景信息注入完毕] ${item.name}`);

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
    await new Promise(r => setTimeout(r, 300));
  }

  const specials = rawData?.specials?.items || [];
  for (let i = 0; i < Math.min(specials.length, 5); i++) {
    const item = specials[i];
    const discount = item.discount_percent;
    const finalPrice = (item.final_price / 100).toFixed(2);
    const originalPrice = (item.original_price / 100).toFixed(2);
    
    const meta = await fetchSteamGameDescription(item.id, item.name);
    console.log(`      -> [全景信息注入完毕] ${item.name}`);

    const fullDesc = `【实时特惠折扣 -${discount}%】原价 ¥${originalPrice}，当前促销现价仅需 ¥${finalPrice}！\n\n${meta.description}`;
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
    await new Promise(r => setTimeout(r, 300));
  }

  return tabData;
}

/**
 * 🕹️ 3. 【彻底修复】实时对接 Itch.io 官方高热度精选 RSS 核心流
 */
async function fetchItchioIndependentSales() {
  const list = [];
  try {
    console.log("🔮 正在通过官方安全信道拉取 Itch.io 热门独立游戏流...");
    const rssXml = await makeRequest("https://itch.io/games/featured.xml");
    
    if (!rssXml || typeof rssXml !== 'string') {
      console.error("⚠️ Itch.io 核心流响应格式异常。");
      return list;
    }

    // 纯正则极速安全切分 `<item>` 标签
    const itemMatches = rssXml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    console.log(`   [Itch.io 核心流通报] 成功拦截到 ${itemMatches.length} 款全球精选独立游戏。`);

    for (let i = 0; i < Math.min(itemMatches.length, 5); i++) {
      const itemXml = itemMatches[i];
      
      // 提取标题
      const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || itemXml.match(/<title>(.*?)<\/title>/);
      // 提取链接
      const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
      // 提取原始纯文本简介
      let plainDesc = "充满极高创意与独立极客精神的神作，玩法机制独特，极具艺术发掘价值。";
      const descMatch = itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || itemXml.match(/<description>([\s\S]*?)<\/description>/);
      if (descMatch && descMatch[1]) {
        plainDesc = descMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().substring(0, 150);
      }

      const name = titleMatch ? titleMatch[1] : "未名独立神作";
      const appUrl = linkMatch ? linkMatch[1] : "https://itch.io";

      console.log(`   [独立游多维合成] -> ${name}`);
      const fullRichDesc = await generateDeepFullDescription(name, plainDesc);
      const aiReview = await generateUniqueAIReview(name, "全球热门独立精选", fullRichDesc);

      list.push({
        rank: `热门精选`,
        appId: `itch-featured-${i}`,
        name: `[独立] ${name}`,
        developer: "Itch.io 独立极客",
        icon: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300", // 精选池使用通用艺术质感图
        primaryGenre: "Itch.io 热门榜",
        description: `【Itch.io 官方精选推荐】\n\n${fullRichDesc}`,
        ratingCount: "全球高热度",
        reviews: [{ author: "Wannet 独立游戏人", rating: "🎨 艺术评级", content: aiReview }],
        appStoreUrl: appUrl
      });
    }
  } catch (e) {
    console.error("⚠️ Itch.io 独立游戏流处理受阻: " + e.message);
  }
  return list;
}

// 主控编排
(async () => {
  const result = { updateTime: new Date().toISOString(), regions: {} };

  try {
    // 1. 获取 Steam 骨干数据
    const steamMain = await fetchSteamMainData();
    result.regions['steam'] = { games: steamMain.steam };
    result.regions['sale'] = { games: steamMain.sale };

    // 2. 混合聚合流限免
    const aggregatedFree = await fetchAggregatedFreeGames(steamMain.rawItems);
    result.regions['free'] = { games: aggregatedFree };

    // 3. 获取 Itch.io 独立游戏
    const itchGames = await fetchItchioIndependentSales();
    result.regions['itch'] = { games: itchGames };

    const total = aggregatedFree.length + steamMain.steam.length + steamMain.sale.length + itchGames.length;
    if (total === 0) throw new Error("❌ 各公开平台网络接口全线彻底挂断，拦截空数据！");

    const outputDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'games.json'), JSON.stringify(result, null, 2), 'utf-8');
    
    console.log(`\n✅ 【完美部署自愈成功】成功写入 ${total} 条全景数据！`);
  } catch (error) {
    console.error("\n💥 脚本运行崩溃:", error.message);
    process.exit(1);
  }
})();
