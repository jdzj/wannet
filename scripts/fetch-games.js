const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DEEPSEEK_FULL_URL = "https://api.newsspace.cn/v1/chat/completions";

// 🛡️ 终极防御网络请求工具：任何解析失败均降级为普通文本，绝不抛出崩溃
function makeRequest(targetUrl, method = 'GET', headers = {}, postData = null) {
  return new Promise((resolve) => {
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
        try { 
          // 确保只有合法的 JSON 字符串才会被解析
          if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
            resolve(JSON.parse(data)); 
          } else {
            resolve(data);
          }
        } catch (e) { 
          resolve(data); 
        }
      });
    });
    
    req.on('error', (err) => {
      console.error(`      ⚠️ [网络网络警告] 请求 ${targetUrl} 失败: ${err.message}`);
      resolve(null); // 返回 null 允许上层逻辑自愈
    });
    
    req.setTimeout(10000, () => { 
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
  return fallbackText; // 核心自愈：AI 熔断时提供结构化格式保护
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
  for (let i = 0; i < Math.min(topSellers.length, 5); i++) { // 控制在前 5 核心大作，加快 GitHub 编译效率
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
 * 🕹️ 3. 获取 Itch.io 独立游戏促销流
 */
async function fetchItchioIndependentSales() {
  const list = [];
  try {
    console.log("🔮 正在连线 Itch.io 全球独立游戏开放流...");
    const url = "https://itch.io/games/on-sale.json";
    const res = await makeRequest(url);
    const games = res?.games || [];

    for (let i = 0; i < Math.min(games.length, 5); i++) {
      const g = games[i];
      const name = g.title;
      const baseText = g.short_text || "";
      const fullRichDesc = await generateDeepFullDescription(name, baseText);
      const priceText = g.price || "特惠促销中";
      console.log(`   [独立游多维合成] -> ${name}`);

      const aiReview = await generateUniqueAIReview(name, "独立精品促销", fullRichDesc);
      list.push({
        rank: `独立精选`,
        appId: `itch-${g.id}`,
        name: `[独立] ${name}`,
        developer: g.user?.username || "独立工作室",
        icon: g.cover_url || "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300",
        primaryGenre: "Itch.io 独立游戏",
        description: `【Itch.io 独立特惠】售价：${priceText}。\n\n${fullRichDesc}`,
        ratingCount: "创意爆表",
        reviews: [{ author: "Wannet 独立游戏人", rating: "🎨 艺术评级", content: aiReview }],
        appStoreUrl: g.url || "https://itch.io"
      });
    }
  } catch (e) {
    console.error("⚠️ Itch.io 独立游戏流断开。");
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

    // 只有在数据彻底为空白（底层网络挂掉）时才触发断流错误，单接口报错不会受阻
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
