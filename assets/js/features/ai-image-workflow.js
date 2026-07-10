export function createAiImageWorkflowFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fieldValue,
  setElementsDisabled,
  setText,
  storage = globalThis.localStorage,
  trimmedFieldValue,
} = {}) {
  const AI_WORKFLOW_STORAGE_KEY = "tanjia:aiImageWorkflow:v4";
  let currentAiImageWorkflow = null;
  let currentAiListingCopy = null;
  let currentAiProductImages = [];
  
  const aiWorkflowMarkets = {
    US: { label: "美国站 · 英文", main: "Everything You Need", feature: "Built for", scene: "Made for Real Life", details: "Details That Matter", compare: "Why Choose", plus: "More Than a Product" },
    CA: { label: "加拿大站 · 英文", main: "Everything You Need", feature: "Built for", scene: "Made for Real Life", details: "Details That Matter", compare: "Why Choose", plus: "More Than a Product" },
    DE: { label: "德国站 · 德文", main: "Alles, was Sie brauchen", feature: "Entwickelt für", scene: "Für den Alltag gemacht", details: "Details, die zählen", compare: "Darum", plus: "Mehr als ein Produkt" },
    FR: { label: "法国站 · 法文", main: "Tout ce qu'il vous faut", feature: "Conçu pour", scene: "Pensé pour le quotidien", details: "Les détails essentiels", compare: "Pourquoi choisir", plus: "Plus qu'un produit" },
    ES: { label: "西班牙站 · 西文", main: "Todo lo que necesitas", feature: "Diseñado para", scene: "Hecho para la vida real", details: "Detalles que importan", compare: "Por qué elegir", plus: "Más que un producto" },
    JP: { label: "日本站 · 日文", main: "必要なものを、ひとつに", feature: "使いやすさを追求", scene: "毎日のための設計", details: "細部までわかりやすく", compare: "選ばれる理由", plus: "製品以上の価値" },
  };
  
  const aiWorkflowStyles = {
    technology: { label: "科技专业", direction: "clean technical studio, cool neutral light, precise details, restrained blue accents" },
    home: { label: "简洁家居", direction: "bright modern home, soft natural daylight, warm neutral materials, uncluttered composition" },
    outdoor: { label: "户外力量", direction: "authentic outdoor environment, directional sunlight, durable tactile materials, energetic composition" },
    premium: { label: "高级质感", direction: "premium editorial studio, controlled softbox lighting, refined dark neutrals, sophisticated material detail" },
    minimal: { label: "极简参数", direction: "minimal white and light gray studio, orthographic clarity, generous negative space, accurate proportions" },
  };
  
  const aiProductLineTemplates = {
    "rc-car": {
      name: "遥控车",
      productName: "1:16 高速遥控越野车",
      category: "Remote Control Cars",
      audience: "6-12岁儿童、青少年和亲子遥控爱好者",
      scenes: ["户外草地和碎石路竞速", "后院亲子遥控比赛", "生日和节日礼物玩乐"],
      features: ["高速动力", "2.4GHz 比例操控", "全地形轮胎", "抗冲击车身", "双电池长续航"],
      parameters: ["比例 1:16", "最高速度 25 km/h", "2.4GHz 遥控", "遥控距离 50 m", "双充电电池", "适用草地、沙地与碎石路"],
      competitor: "https://www.amazon.com/s?k=1%3A16+high+speed+rc+car",
      style: "energetic",
      parameterHint: "建议填写比例、最高速度、遥控距离、驱动形式、电池和适用地形。",
      headline: "Ready to Race",
      featureHeadlines: ["High-Speed Racing", "Precision 2.4GHz Control"],
      compareHeadline: "More Control. More Adventure.",
      sceneHeadline: "Conquer Every Backyard",
      sceneVisual: "户外碎石路或短草地赛道，展示车轮抓地、扬尘和真实操控距离，保留安全活动空间。",
      scenePrompt: "Show the RC car racing on a realistic backyard dirt and short-grass track, visible wheel grip and controlled dust, child or parent operating from a safe distance, no impossible jumps.",
      compareVisual: "对比普通玩具车与本产品在操控、轮胎、悬挂和续航上的差异，避免无法证明的极限性能。",
      comparePrompt: "Compare ordinary toy-grade RC driving with responsive proportional control, all-terrain tires, suspension and longer play time. Keep the comparison factual and visually simple.",
      aplusVisual: "宽幅组合展示车体结构、遥控器、电池、地形玩法和亲子竞速氛围。",
      promptConstraint: "The car body shell, scale, wheel tread, suspension, controller, battery count and included accessories must match the reference product. No full-size vehicle appearance, no impossible stunts, no fire or dangerous road traffic.",
      delivery: ["车体比例、轮胎纹路和驱动形式已核对", "遥控器、电池数量和配件与实物一致", "速度与遥控距离表述有产品资料支持"],
      listing: {
        name: "1:16 High Speed RC Car",
        oldTitle: "1:16 High Speed RC Car for Kids, 2.4GHz Proportional Control Off Road Remote Control Truck with All-Terrain Tires, Shock-Resistant Body and 2 Rechargeable Batteries",
        title: "1:16 High Speed RC Car for Kids with 2.4GHz Control and 2 Batteries",
        highlights: "All-terrain tires, shock-resistant body and dual batteries support longer backyard racing on grass, sand and gravel.",
        bullets: [
          ["HIGH-SPEED OFF-ROAD FUN", "Powerful performance delivers exciting racing on grass, sand, gravel and backyard tracks for kids, teens and family RC play."],
          ["PRECISE 2.4GHz CONTROL", "Responsive proportional steering and throttle provide smoother turns, stable control and interference-free racing with multiple cars."],
          ["BUILT FOR TOUGH TERRAIN", "All-terrain tires, independent suspension and a shock-resistant body help the truck handle bumps and uneven surfaces."],
          ["EXTENDED PLAY TIME", "Two rechargeable batteries provide longer driving sessions, while the included controller makes setup simple and convenient."],
          ["GIFT-READY RC ADVENTURE", "A fun remote control vehicle for birthdays, holidays and outdoor family time; suitable for new drivers and young RC enthusiasts."],
        ],
        description: "Bring high-speed RC action to the backyard with this 1:16 off-road remote control car. Designed for kids, teens and family play, it combines responsive 2.4GHz proportional control with all-terrain tires, durable suspension and a shock-resistant body. Two rechargeable batteries keep the adventure going longer across grass, sand, gravel and indoor floors. The complete set is easy to start and makes an exciting gift for birthdays, holidays and everyday racing fun.",
        keywords: "rc car remote control car for kids high speed rc truck off road toy 2.4ghz proportional control all terrain rechargeable battery boys girls gift",
      },
    },
    "rc-boat": {
      name: "遥控船",
      productName: "高速自动翻正遥控赛艇",
      category: "Remote Control Boats",
      audience: "8岁以上儿童、青少年和亲子水上遥控爱好者",
      scenes: ["泳池遥控竞速", "平静湖面亲子互动", "夏季户外水上玩乐"],
      features: ["高速水上动力", "翻船自动回正", "双层防水船体", "低电量提醒", "双电池长续航"],
      parameters: ["最高速度 30 km/h", "2.4GHz 遥控", "遥控距离 120 m", "自动翻正功能", "双充电电池", "适用泳池与平静湖面"],
      competitor: "https://www.amazon.com/s?k=high+speed+self+righting+rc+boat",
      style: "energetic",
      parameterHint: "建议填写最高速度、遥控距离、翻正功能、电池、续航、船体尺寸和适用水域。",
      headline: "Own the Water",
      featureHeadlines: ["High-Speed Water Racing", "Self-Righting Recovery"],
      compareHeadline: "Built for Better Boating",
      sceneHeadline: "Fast. Stable. Ready.",
      sceneVisual: "平静泳池或湖面竞速，展示 V 型水浪、转弯轨迹和遥控操作，不使用海浪或载人场景。",
      scenePrompt: "Show the RC speed boat racing on a calm pool or lake, realistic V-shaped wake and controlled turn, operator safely on shore, no ocean waves, no rider and no storm conditions.",
      compareVisual: "对比普通遥控船与本产品在翻正、防水、提醒和操控距离上的差异。",
      comparePrompt: "Compare a basic RC boat with self-righting recovery, sealed hull protection, low-battery warning and longer control range. Use calm water and factual visual proof.",
      aplusVisual: "宽幅展示船体流线、翻正过程、防水结构、遥控器和亲子水上竞速场景。",
      promptConstraint: "The hull shape, decals, propeller, rudder, controller and batteries must match the reference product. Use only calm controlled water. No person riding the boat, no open ocean, no huge waves and no invented waterproof depth.",
      delivery: ["船体外观、螺旋桨和舵结构已核对", "翻正、防水和低电提醒以实际功能为准", "场景仅使用产品允许的平静水域"],
      listing: {
        name: "High Speed Self-Righting RC Boat",
        oldTitle: "High Speed RC Boat for Pools and Lakes, 2.4GHz Remote Control Racing Boat with Self-Righting Hull, Low Battery Alert and 2 Rechargeable Batteries",
        title: "High Speed Self-Righting RC Boat for Pools and Lakes with 2 Batteries",
        highlights: "Self-righting recovery, sealed hull and low-battery alert support stable racing on pools and calm lakes.",
        bullets: [
          ["FAST WATER RACING", "Streamlined power and responsive steering create exciting speed and smooth turns on pools and calm lakes."],
          ["SELF-RIGHTING RECOVERY", "The flip recovery function helps turn the boat upright after capsizing so racing can continue with less interruption."],
          ["RELIABLE 2.4GHz CONTROL", "Long-range interference-resistant control supports stable steering and lets multiple boats race at the same time."],
          ["SMART PLAY PROTECTION", "A sealed water-resistant hull and low-battery reminder help protect the boat and make every session easier to manage."],
          ["LONGER FAMILY FUN", "Two rechargeable batteries extend play time for kids, teens and adults who enjoy outdoor water racing."],
        ],
        description: "Race across pools and calm lakes with a streamlined remote control speed boat built for responsive handling and family fun. The self-righting hull helps recover from flips, while 2.4GHz control delivers stable steering at a distance. A sealed hull, low-battery alert and two rechargeable batteries make every session easier and longer. Ideal for kids, teens and adults who enjoy safe outdoor RC water play.",
        keywords: "rc boat remote control boat high speed racing boat self righting pool toy lake boat rechargeable 2.4ghz water toy boys girls adults gift",
      },
    },
    "bubble-machine": {
      name: "泡泡机玩具",
      productName: "儿童电动多孔泡泡机",
      category: "Bubble Makers",
      audience: "3岁以上儿童、家庭派对、生日活动和户外聚会用户",
      scenes: ["儿童生日派对", "后院和公园户外玩乐", "婚礼与家庭聚会互动"],
      features: ["连续丰富出泡", "多孔高速出泡", "彩色灯光效果", "轻量便携", "低噪音运行"],
      parameters: ["出泡孔数 10 孔", "每分钟约 1000 个泡泡", "电池供电", "泡泡液容量 200 ml", "适用年龄 3+", "含泡泡液托盘与配件"],
      competitor: "https://www.amazon.com/s?k=automatic+bubble+machine+for+kids",
      style: "energetic",
      parameterHint: "建议填写出泡孔数、每分钟泡泡量、供电方式、容量、尺寸、配件和适用年龄。",
      headline: "Fill the Air with Fun",
      featureHeadlines: ["Bubbles by the Thousands", "More Bubbles, More Smiles"],
      compareHeadline: "Hands-Free Bubble Fun",
      sceneHeadline: "Instant Party Magic",
      sceneVisual: "后院生日派对或家庭聚会，儿童在成人陪同下追逐泡泡，产品保持清晰可见。",
      scenePrompt: "Show a cheerful backyard birthday party with children enjoying bubbles under adult supervision, abundant translucent bubbles with readable depth, product clearly visible and not hidden by bubble density.",
      compareVisual: "对比手动吹泡泡与自动连续出泡在泡泡量、持续性和多人互动上的差异。",
      comparePrompt: "Compare manual bubble blowing with continuous automatic bubble output, showing more bubbles, hands-free play and group interaction without exaggerated or impossible density.",
      aplusVisual: "宽幅展示产品、出泡口、灯光、便携结构和生日派对、婚礼或后院玩法。",
      promptConstraint: "The product shape, bubble outlet count, lights, handle, tray and included solution accessories must match the reference. Bubbles should look translucent and physically plausible. No child drinking solution, no product submerged in water and no unattended toddler.",
      delivery: ["出泡口数量、灯光和供电方式已核对", "泡泡量描述有产品测试或资料支持", "泡泡液、托盘和附件与包装清单一致"],
      listing: {
        name: "Automatic Bubble Machine for Kids",
        oldTitle: "Automatic Bubble Machine for Kids, High Output Multi-Hole Bubble Maker with Colorful Lights, Portable Bubble Toy for Birthday Parties, Backyard Play and Weddings",
        title: "Automatic Bubble Machine for Kids with Colorful Lights",
        highlights: "High-output multi-hole design creates continuous bubbles for birthdays, backyard play, weddings and family parties.",
        bullets: [
          ["BUBBLES BY THE THOUSANDS", "Multi-hole continuous output fills the air with abundant bubbles for exciting group play and memorable party moments."],
          ["COLORFUL LIGHT-UP FUN", "Built-in lights add extra visual excitement for birthdays, evening events, indoor celebrations and outdoor play."],
          ["EASY HANDS-FREE PLAY", "Simply add bubble solution and turn it on for continuous bubbles without repeated dipping or blowing."],
          ["PORTABLE AND QUIET", "The lightweight design is easy to carry between the backyard, park, wedding, stage or family gathering."],
          ["A PARTY FAVORITE", "A cheerful bubble toy for kids ages 3 and up that encourages movement, laughter and shared family fun."],
        ],
        description: "Turn any celebration into a bubble-filled experience with this automatic bubble machine for kids. Its multi-hole design creates a steady stream of bubbles while colorful lights add extra excitement. Lightweight, portable and simple to operate, it is ideal for birthday parties, backyard play, weddings, stages and family gatherings. Add bubble solution, switch it on and let kids enjoy active hands-free fun under adult supervision.",
        keywords: "bubble machine for kids automatic bubble maker high output bubble toy light up party supplies birthday backyard wedding outdoor indoor toddler gift",
      },
    },
    "water-table-sink": {
      name: "过家家水池玩具",
      productName: "循环出水过家家水池玩具",
      category: "Kids Water Table Sink Toys",
      audience: "3-8岁儿童、亲子家庭和角色扮演游戏用户",
      scenes: ["居家厨房角色扮演", "游戏房亲子互动", "露台浅水感官玩乐"],
      features: ["电动循环出水", "真实水龙头体验", "丰富厨房配件", "角色扮演启蒙", "亲子互动与收纳"],
      parameters: ["产品高度 82 cm", "循环水泵供水", "电池供电", "配件 25 件", "适用年龄 3+", "水槽、餐具、食材与收纳架"],
      competitor: "https://www.amazon.com/s?k=kids+working+sink+water+table+toy",
      style: "parent",
      parameterHint: "建议填写尺寸和高度、循环水泵、供电、配件数量、水槽容量、材质和适用年龄。",
      headline: "Little Chefs, Big Imagination",
      featureHeadlines: ["Real Running Water", "25-Piece Pretend Play Set"],
      compareHeadline: "More Ways to Pretend and Play",
      sceneHeadline: "Real Water Play at Home",
      sceneVisual: "明亮厨房、游戏房或露台，儿童在成人陪同下洗水果、洗餐具并进行角色扮演。",
      scenePrompt: "Show children using the pretend play sink in a bright playroom, kitchen corner or patio under adult supervision, washing toy dishes and play food, realistic product-to-child scale and shallow contained water.",
      compareVisual: "对比静态厨房玩具与循环出水水池玩具在真实体验、配件玩法和互动时长上的差异。",
      comparePrompt: "Compare a static pretend kitchen with a working recirculating water sink, highlighting running water play, included accessories, role-play variety and organized storage.",
      aplusVisual: "宽幅展示循环水路、水龙头、双层收纳、餐具食材配件和亲子角色扮演。",
      promptConstraint: "The sink dimensions, faucet, pump area, shelves, accessory count and colors must match the reference product. Show shallow contained water only, realistic child scale, adult supervision and no deep pool environment.",
      delivery: ["产品高度与儿童尺寸关系真实", "水循环路径、供电方式和水槽结构已核对", "餐具、食材和配件数量与包装清单一致"],
      listing: {
        name: "Kids Working Sink Water Table Toy",
        oldTitle: "Kids Working Sink Water Table Toy with Running Water Faucet, Pretend Play Kitchen Set with Dishes, Play Food and Storage Accessories for Toddlers Ages 3+",
        title: "Kids Working Sink Toy with Running Water Faucet and Kitchen Accessories",
        highlights: "Recirculating water, dishes, play food and storage accessories create realistic pretend kitchen play for ages 3+.",
        bullets: [
          ["REAL RUNNING WATER PLAY", "The recirculating faucet creates an engaging sink experience while reusing water inside the basin for contained play."],
          ["COMPLETE PRETEND KITCHEN SET", "Included dishes, utensils, play food and storage accessories give children more ways to wash, cook, organize and imagine."],
          ["ENCOURAGES ROLE PLAY", "Hands-on kitchen play supports creativity, communication, fine motor skills and everyday habit learning."],
          ["CHILD-FRIENDLY PLAY HEIGHT", "The freestanding design provides a comfortable play setup for toddlers and young children at home or on the patio."],
          ["FUN FOR SHARED PLAY", "A playful water table sink for siblings, friends and parent-child interaction; a thoughtful gift for ages 3 and up."],
        ],
        description: "Create a realistic pretend kitchen experience with a kids working sink toy that uses recirculating running water. Children can wash play food and dishes, organize accessories and enjoy imaginative role play with family and friends. The child-friendly freestanding design includes kitchen accessories and storage areas for more complete play. Ideal for playrooms, kitchens and patios with adult supervision.",
        keywords: "kids working sink toy water table kitchen playset running water faucet pretend play dishes food toddler role play toy ages 3 4 5 gift",
      },
    },
    "soccer-robots": {
      name: "双人对战遥控足球机器人",
      productName: "双人对战遥控足球机器人玩具",
      category: "Remote Control Robots",
      audience: "6岁以上男女孩、益智玩具爱好者、亲子互动家庭",
      scenes: ["居家亲子休闲对战", "朋友聚会趣味互动", "儿童生日礼物玩乐"],
      features: ["双人遥控足球对战", "蓝黄双机竞技套装", "锻炼手眼协调与反应能力", "亲子和朋友互动玩法", "足球主题机器人造型"],
      parameters: ["外观：蓝、黄两款足球造型机器人，搭配对应色遥控手柄", "配件：足球 1 颗，双人遥控对战套装"],
      competitor: "https://www.amazon.com/s?k=remote+control+soccer+robots+2+player",
      style: "energetic",
      parameterHint: "建议填写机器人颜色、遥控方式、套装数量、足球和其他包装配件。",
      listing: {
        name: "2 Player Remote Control Soccer Robots",
        oldTitle: "2 Player Remote Control Soccer Robot Toys for Kids Ages 6+, Blue and Yellow RC Football Battle Set with 2 Controllers and Soccer Ball, Interactive Indoor Game Gift",
        title: "2 Player Remote Control Soccer Robot Toys for Kids Ages 6+",
        highlights: "Blue and yellow robots, matching controllers and a soccer ball create interactive indoor matches for family and friends.",
        bullets: [
          ["EXCITING 2-PLAYER SOCCER BATTLES", "Control two soccer robots head to head for fast, friendly matches that bring active competition to indoor family play."],
          ["COMPLETE BLUE AND YELLOW SET", "Includes two football-style robots, matching remote controllers and one soccer ball for ready-to-play challenges."],
          ["BUILDS COORDINATION THROUGH PLAY", "Remote control movement and goal scoring encourage hand-eye coordination, quick reactions and strategic thinking."],
          ["FUN FOR FAMILY AND FRIENDS", "A lively choice for parent-child game time, playdates, parties and friendly competitions at home."],
          ["GIFT FOR KIDS AGES 6+", "A memorable birthday or holiday toy for boys and girls who enjoy robots, soccer, remote control toys and interactive games."],
        ],
        description: "Bring robot action and soccer competition together with this two-player remote control football battle set. The blue and yellow soccer-style robots use matching controllers so kids, friends and parents can compete in quick indoor matches. With one soccer ball included, the complete set encourages hand-eye coordination, reaction skills and strategic play while creating more face-to-face family interaction. A fun gift for boys and girls ages 6 and up who enjoy robots, soccer and remote control games.",
        keywords: "remote control soccer robots 2 player rc football game robot toys for kids blue yellow battle set indoor family game boys girls age 6 birthday gift",
      },
    },
  };
  
  function aiWorkflowValue(selector) {
    return trimmedFieldValue(selector);
  }
  
  function splitAiWorkflowItems(value) {
    return String(value || "").split(/[\n,，;；、]+/).map((item) => item.trim()).filter(Boolean);
  }
  
  function getAiWorkflowFormData() {
    return {
      productLine: aiWorkflowValue("#ai-product-line") || "soccer-robots",
      productName: aiWorkflowValue("#ai-product-name"),
      category: aiWorkflowValue("#ai-product-category"),
      market: aiWorkflowValue("#ai-target-market") || "US",
      audience: aiWorkflowValue("#ai-target-audience"),
      scenes: aiWorkflowValue("#ai-use-scenes"),
      features: aiWorkflowValue("#ai-core-features"),
      parameters: aiWorkflowValue("#ai-product-parameters"),
      competitor: aiWorkflowValue("#ai-competitor-reference"),
      style: aiWorkflowValue("#ai-visual-style") || "technology",
    };
  }
  
  function setAiWorkflowFormData(data = {}) {
    const fields = {
      "#ai-product-line": data.productLine,
      "#ai-product-name": data.productName,
      "#ai-product-category": data.category,
      "#ai-target-market": data.market,
      "#ai-target-audience": data.audience,
      "#ai-use-scenes": data.scenes,
      "#ai-core-features": data.features,
      "#ai-product-parameters": data.parameters,
      "#ai-competitor-reference": data.competitor,
      "#ai-visual-style": data.style,
    };
    Object.entries(fields).forEach(([selector, value]) => {
      const element = root.querySelector(selector);
      if (element && value !== undefined) element.value = value;
    });
  }
  
  function makeAiWorkflowCard(index, type, title, headline, subcopy, visual, prompt) {
    return { index, type, title, headline, subcopy, visual, prompt };
  }
  
  function buildAiImageWorkflow(form) {
    const productLine = aiProductLineTemplates[form.productLine] || aiProductLineTemplates["rc-car"];
    const product = form.productName || "产品";
    const category = form.category || "亚马逊商品";
    const audience = form.audience || "目标用户";
    const market = aiWorkflowMarkets[form.market] || aiWorkflowMarkets.US;
    const style = aiWorkflowStyles[form.style] || aiWorkflowStyles.technology;
    const features = splitAiWorkflowItems(form.features);
    while (features.length < 3) features.push(["核心性能", "轻松使用", "可靠品质"][features.length]);
    const parameters = splitAiWorkflowItems(form.parameters);
    const [featureOne, featureTwo, featureThree] = features;
    const featureHeadlineOne = featureOne === productLine.features[0] ? productLine.featureHeadlines[0] : `${market.feature} ${featureOne}`;
    const featureHeadlineTwo = featureTwo === productLine.features[1] ? productLine.featureHeadlines[1] : `${market.feature} ${featureTwo}`;
    const commonPrompt = `Product: ${product}. Category: ${category}. Keep the product identity, structure, color, proportions and included accessories accurate. Visual style: ${style.direction}. Amazon ecommerce image, high commercial quality, sharp material detail, clear visual hierarchy, space reserved for layout. ${productLine.promptConstraint} No watermark, no random text, no distorted product and no extra accessories.`;
    const cards = [
      makeAiWorkflowCard(1, "main", "白底主图", productLine.headline || market.main, `${product} 与标准配件完整展示`, "纯白背景，产品居中偏正面，完整呈现轮廓、材质、遥控或玩法配件。", `${commonPrompt} Create an Amazon-compliant main image on pure white background (#FFFFFF), product centered and fully visible, three-quarter front view, included accessories arranged neatly, no text, no graphic overlays, product fills about 85% of canvas.`),
      makeAiWorkflowCard(2, "feature", "核心卖点 1", featureHeadlineOne, `突出 ${featureOne} 带来的直接用户利益`, `用近景细节或功能动作证明“${featureOne}”，主视觉只表达一个卖点。`, `${commonPrompt} Create a feature image demonstrating ${featureOne}. Show a clear cause-and-effect product action, close-up proof detail, strong focal point, practical benefit immediately understandable to ${audience}.`),
      makeAiWorkflowCard(3, "feature", "核心卖点 2", featureHeadlineTwo, `强化 ${featureTwo}，与第一卖点形成互补`, `通过结构剖面、局部放大或使用前后状态，说明“${featureTwo}”。`, `${commonPrompt} Create a second feature image focused on ${featureTwo}. Use a different composition from the first feature image, with accurate product detail and a visually convincing proof point.`),
      makeAiWorkflowCard(4, "scene", "使用场景", productLine.sceneHeadline || market.scene, `${audience} 在真实环境中自然使用 ${product}`, productLine.sceneVisual, `${commonPrompt} ${productLine.scenePrompt}`),
      makeAiWorkflowCard(5, "details", "尺寸参数", market.details, parameters.length ? parameters.slice(0, 3).join(" · ") : "尺寸、材质与关键参数一图看清", "正视或侧视产品，保留测量线、参数标注和局部材质放大区域。", `${commonPrompt} Create a clean specification image with front and side product views, generous negative space for dimension lines and parameter labels. Accurate orthographic perspective, no invented measurements.`),
      makeAiWorkflowCard(6, "compare", "对比说明", productLine.compareHeadline || `${market.compare} ${product}`, `${featureOne} · ${featureTwo} · ${featureThree}`, productLine.compareVisual, `${commonPrompt} ${productLine.comparePrompt}`),
      makeAiWorkflowCard(7, "aplus", "A+ 延展", market.plus, `${product} 的细节、场景与品牌价值延展`, productLine.aplusVisual, `${commonPrompt} Create a wide Amazon A+ hero composition for ${product}, combining product detail, category-specific play features, a supporting lifestyle environment and room for brand story copy.`),
    ];
    return { form, productLine, market, style, features: features.slice(0, 5), parameters, cards, generatedAt: new Date().toISOString() };
  }
  
  function aiWorkflowCopyText(workflow, type) {
    if (!workflow) return "";
    if (type === "prompt") return workflow.cards.map((card) => `${card.index}. ${card.title}\n${card.prompt}`).join("\n\n");
    return workflow.cards.map((card) => `${card.index}. ${card.title}\n标题：${card.headline}\n副文案：${card.subcopy}\n画面：${card.visual}`).join("\n\n");
  }
  
  async function copyAiWorkflowText(text, successMessage = "已复制") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = root.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setText("#ai-workflow-status", successMessage);
  }
  
  function renderAiProductLineState(productLineKey) {
    const template = aiProductLineTemplates[productLineKey] || aiProductLineTemplates["rc-car"];
    setText("#ai-parameter-hint", template.parameterHint);
  }
  
  function renderAiWorkflowDelivery(productLineKey = "rc-car") {
    const template = aiProductLineTemplates[productLineKey] || aiProductLineTemplates["rc-car"];
    const groups = {
      "#ai-delivery-before": ["产品版本、颜色和配件已确认", "目标站点、语言和适用年龄已确认", "核心卖点顺序已由运营确认", ...template.delivery],
      "#ai-delivery-design": ["主图为纯白背景且无文字", "每张图只表达一个主要信息", "产品结构、比例和颜色准确", "参数、单位和配件数量已核对", "儿童或操作者与产品比例真实", "画面不表现危险或超出产品能力的玩法"],
      "#ai-delivery-final": ["各语言版本信息层级一致", "年龄、警示语和使用场景已检查", "变体颜色和型号已套版", "源文件、成品图和提示词已归档", "文件名包含站点、产品和版本号"],
    };
    Object.entries(groups).forEach(([selector, items]) => {
      const container = root.querySelector(selector);
      if (container) container.innerHTML = items.map((item) => `<label><input type="checkbox" /><span>${escapeHtml(item)}</span></label>`).join("");
    });
  }
  
  function renderAiImageWorkflow(workflow) {
    if (!workflow) return;
    currentAiImageWorkflow = workflow;
    renderAiProductLineState(workflow.form.productLine || "rc-car");
    renderAiWorkflowDelivery(workflow.form.productLine || "rc-car");
    setText("#ai-workflow-summary-title", `${workflow.form.productName || "产品"} · ${workflow.market.label}套图方案`);
    setText("#ai-workflow-summary-text", `${workflow.productLine.name}模板：围绕 ${workflow.features.slice(0, 3).join("、")} 规划七张图片，面向 ${workflow.form.audience || "目标用户"}，采用${workflow.style.label}视觉方向。`);
    setText("#ai-plan-market", workflow.market.label);
    const sellingPoints = root.querySelector("#ai-selling-points");
    if (sellingPoints) sellingPoints.innerHTML = `<strong>核心卖点</strong>${workflow.features.map((feature) => `<span>${escapeHtml(feature)}</span>`).join("")}`;
    const cardGrid = root.querySelector("#ai-image-card-grid");
    if (cardGrid) {
      cardGrid.innerHTML = workflow.cards.map((card) => `
        <article class="ai-image-card">
          <header><i>${card.index}</i><strong>${escapeHtml(card.title)}</strong></header>
          <div class="ai-image-card-preview" data-card-type="${escapeHtml(card.type)}"><span>${escapeHtml(card.headline)}</span><small>${escapeHtml(workflow.form.productName || "PRODUCT")}</small></div>
          <h4>${escapeHtml(card.headline)}</h4>
          <p>${escapeHtml(card.visual)}</p>
          <button type="button" data-ai-copy-card="${card.index}">复制提示词</button>
        </article>
      `).join("");
    }
    const copyList = root.querySelector("#ai-copy-list");
    if (copyList) {
      copyList.innerHTML = workflow.cards.map((card) => `
        <article><i>${card.index}</i><div><span>${escapeHtml(card.title)}</span><h4>${escapeHtml(card.headline)}</h4><p>${escapeHtml(card.subcopy)}</p><small>${escapeHtml(card.visual)}</small></div><button type="button" data-ai-copy-content="${card.index}">复制</button></article>
      `).join("");
    }
    const promptList = root.querySelector("#ai-prompt-list");
    if (promptList) {
      promptList.innerHTML = workflow.cards.map((card) => `
        <article><header><span>${card.index}. ${escapeHtml(card.title)}</span><button type="button" data-ai-copy-prompt="${card.index}">复制提示词</button></header><p>${escapeHtml(card.prompt)}</p></article>
      `).join("");
    }
    storage.setItem(AI_WORKFLOW_STORAGE_KEY, JSON.stringify(workflow.form));
    setText("#ai-workflow-status", `已生成 ${workflow.cards.length} 张图片方案 · ${workflow.market.label}`);
  }
  
  async function generateAiImageWorkflow() {
    const form = getAiWorkflowFormData();
    const requiredFields = [
      ["productName", "#ai-product-name", "产品名称"],
      ["category", "#ai-product-category", "产品类目"],
      ["audience", "#ai-target-audience", "目标人群"],
      ["scenes", "#ai-use-scenes", "使用场景"],
      ["features", "#ai-core-features", "核心功能"],
      ["parameters", "#ai-product-parameters", "产品参数"],
      ["competitor", "#ai-competitor-reference", "竞品链接"],
    ];
    const missing = requiredFields.find(([key]) => !form[key]);
    if (missing) {
      setText("#ai-workflow-status", `请填写${missing[2]}`);
      root.querySelector(missing[1])?.focus();
      return;
    }
    const button = root.querySelector("#ai-generate-workflow");
    setElementsDisabled(button, true);
    setText("#ai-workflow-status", currentAiProductImages.length
      ? `AI 正在分析产品资料和 ${currentAiProductImages.length} 张图片...`
      : "AI 正在分析产品资料...");
    try {
      const response = await fetch("/api/ai/listing-copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          images: currentAiProductImages.map(({ dataUrl, name, type }) => ({ dataUrl, name, type })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.listing) throw new Error(payload.error || "AI 文案生成失败");
      renderAiListingCopy({ ...payload.listing, form, generatedAt: new Date().toISOString() });
      setText("#ai-workflow-status", currentAiProductImages.length
        ? `AI 已分析 ${currentAiProductImages.length} 张图片 · ${payload.model || "ModelScope"}`
        : `AI 文案已生成 · ${payload.model || "ModelScope"}`);
    } catch (error) {
      renderAiListingCopy(buildAiListingCopy(form));
      setText("#ai-workflow-status", `AI 暂不可用，已使用本地模板：${error.message}`);
    } finally {
      setElementsDisabled(button, false);
    }
  }
  
  function applyAiProductLineTemplate(productLineKey, options = {}) {
    const template = aiProductLineTemplates[productLineKey] || aiProductLineTemplates["rc-car"];
    const currentMarket = aiWorkflowValue("#ai-target-market") || "US";
    setAiWorkflowFormData({
      productLine: productLineKey,
      productName: template.productName,
      category: template.category,
      market: options.keepMarket ? currentMarket : "US",
      audience: template.audience,
      scenes: (template.scenes || []).join("\n"),
      features: template.features.join("\n"),
      parameters: template.parameters.join("\n"),
      competitor: template.competitor,
      style: template.style,
    });
    renderAiProductLineState(productLineKey);
    renderAiListingCopy(buildAiListingCopy(getAiWorkflowFormData()));
  }
  
  function loadAiWorkflowExample() {
    applyAiProductLineTemplate(aiWorkflowValue("#ai-product-line") || "soccer-robots", { keepMarket: true });
  }
  
  function resetAiImageWorkflow() {
    setAiWorkflowFormData({ productLine: "soccer-robots", productName: "", category: "", market: "US", audience: "", scenes: "", features: "", parameters: "", competitor: "", style: "clear" });
    storage.removeItem(AI_WORKFLOW_STORAGE_KEY);
    renderAiProductLineState("soccer-robots");
    currentAiListingCopy = null;
    clearAiProductImages();
    const oldTitle = root.querySelector("#ai-listing-old-title");
    const title = root.querySelector("#ai-listing-title");
    const highlights = root.querySelector("#ai-listing-highlights");
    const description = root.querySelector("#ai-listing-description");
    const keywords = root.querySelector("#ai-listing-keywords");
    if (oldTitle) oldTitle.value = "";
    if (title) title.value = "";
    if (highlights) highlights.value = "";
    if (description) description.value = "";
    if (keywords) keywords.value = "";
    const bullets = root.querySelector("#ai-listing-bullets");
    if (bullets) bullets.innerHTML = '<div class="ai-listing-empty">填写左侧产品信息后生成五点描述</div>';
    updateAiListingCounts();
    setText("#ai-workflow-status", "参数已清空");
    root.querySelector("#ai-product-name")?.focus();
  }
  
  function renderAiProductImages() {
    const container = root.querySelector("#ai-product-image-previews");
    if (container) {
      container.innerHTML = currentAiProductImages.map((image) => `
        <figure class="ai-product-image-preview">
          <img src="${image.dataUrl}" alt="${escapeHtml(image.name)}" />
          <figcaption title="${escapeHtml(image.name)}">${escapeHtml(image.name)}</figcaption>
          <button type="button" data-ai-remove-image="${image.id}" aria-label="删除图片 ${escapeHtml(image.name)}">×</button>
        </figure>
      `).join("");
    }
    setText("#ai-product-image-count", `${currentAiProductImages.length} / 3 张`);
    const upload = root.querySelector("#ai-product-image-upload");
    if (upload) upload.classList.toggle("is-full", currentAiProductImages.length >= 3);
    const input = root.querySelector("#ai-product-images");
    if (input) input.disabled = currentAiProductImages.length >= 3;
  }
  
  function clearAiProductImages() {
    currentAiProductImages = [];
    const input = root.querySelector("#ai-product-images");
    if (input) input.value = "";
    setText("#ai-product-image-note", "建议上传正面、侧面和配件图，单张图片不超过 10MB。");
    renderAiProductImages();
  }
  
  function removeAiProductImage(id) {
    currentAiProductImages = currentAiProductImages.filter((image) => image.id !== id);
    const input = root.querySelector("#ai-product-images");
    if (input) input.value = "";
    setText("#ai-product-image-note", "图片已删除，可继续补充其他角度。");
    renderAiProductImages();
  }
  
  function loadAiImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`${file.name} 无法读取`));
        image.src = reader.result;
      };
      reader.onerror = () => reject(new Error(`${file.name} 无法读取`));
      reader.readAsDataURL(file);
    });
  }
  
  async function compressAiProductImage(file) {
    const image = await loadAiImageFile(file);
    const maxSide = 1000;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = root.createElement("canvas");
    const context = canvas.getContext("2d");
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    let dataUrl = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      dataUrl = canvas.toDataURL("image/jpeg", Math.max(0.46, 0.78 - attempt * 0.06));
      if (dataUrl.length <= 260000) break;
      if (Math.max(width, height) <= 560) break;
      width = Math.max(1, Math.round(width * 0.84));
      height = Math.max(1, Math.round(height * 0.84));
    }
    return {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      type: "image/jpeg",
      dataUrl,
    };
  }
  
  async function handleAiProductImageSelection(event) {
    const files = [...(event.target.files || [])];
    const slots = Math.max(0, 3 - currentAiProductImages.length);
    const accepted = files.slice(0, slots);
    const invalid = accepted.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024);
    if (invalid) {
      setText("#ai-product-image-note", `${invalid.name} 格式不支持或超过 10MB。`);
      event.target.value = "";
      return;
    }
    if (!accepted.length) {
      setText("#ai-product-image-note", "最多只能上传 3 张产品图片。");
      event.target.value = "";
      return;
    }
    setText("#ai-product-image-note", "正在压缩图片...");
    setElementsDisabled(event.target, true);
    try {
      const images = await Promise.all(accepted.map(compressAiProductImage));
      currentAiProductImages = [...currentAiProductImages, ...images].slice(0, 3);
      setText("#ai-product-image-note", files.length > slots ? `已添加 ${images.length} 张，超出上限的图片未上传。` : `已添加 ${images.length} 张图片，生成时将交给 AI 分析。`);
    } catch (error) {
      setText("#ai-product-image-note", error.message || "图片处理失败。");
    } finally {
      event.target.value = "";
      renderAiProductImages();
    }
  }
  
  function buildAiListingCopy(form) {
    const template = aiProductLineTemplates[form.productLine] || aiProductLineTemplates["rc-car"];
    const source = template.listing;
    const oldTitle = form.productName && form.productName !== template.productName
      ? source.oldTitle.replace(source.name, form.productName)
      : source.oldTitle;
    const title = form.productName && form.productName !== template.productName
      ? source.title.replace(source.name, form.productName)
      : source.title;
    return {
      form,
      oldTitle: oldTitle.slice(0, 200),
      title: title.slice(0, 75),
      highlights: source.highlights.slice(0, 125),
      bullets: source.bullets.map(([heading, body]) => `${heading} - ${body}`),
      description: source.description,
      keywords: source.keywords,
      generatedAt: new Date().toISOString(),
    };
  }
  
  function getAiListingValues() {
    return {
      oldTitle: aiWorkflowValue("#ai-listing-old-title"),
      title: aiWorkflowValue("#ai-listing-title"),
      highlights: aiWorkflowValue("#ai-listing-highlights"),
      bullets: [...root.querySelectorAll("[data-ai-bullet-index]")].map((item) => trimmedFieldValue(item)).filter(Boolean),
      description: aiWorkflowValue("#ai-listing-description"),
      keywords: aiWorkflowValue("#ai-listing-keywords"),
    };
  }
  
  function aiListingCopyText(type = "all") {
    const values = getAiListingValues();
    if (type === "oldTitle") return values.oldTitle;
    if (type === "title") return values.title;
    if (type === "highlights") return values.highlights;
    if (type === "bullets") return values.bullets.join("\n\n");
    if (type === "description") return values.description;
    if (type === "keywords") return values.keywords;
    return [
      "LEGACY TITLE (200 CHARACTERS)",
      values.oldTitle,
      "",
      "NEW TITLE (JULY 27, 2026)",
      values.title,
      "",
      "ITEM HIGHLIGHTS",
      values.highlights,
      "",
      "BULLET POINTS",
      ...values.bullets.map((bullet, index) => `${index + 1}. ${bullet}`),
      "",
      "PRODUCT DESCRIPTION",
      values.description,
      "",
      "SEARCH TERMS",
      values.keywords,
    ].join("\n");
  }
  
  function aiUtf8Bytes(value) {
    return typeof TextEncoder === "function" ? new TextEncoder().encode(value).length : unescape(encodeURIComponent(value)).length;
  }
  
  function updateAiListingCounts() {
    const oldTitle = fieldValue("#ai-listing-old-title");
    const title = fieldValue("#ai-listing-title");
    const highlights = fieldValue("#ai-listing-highlights");
    const description = fieldValue("#ai-listing-description");
    const keywords = fieldValue("#ai-listing-keywords");
    setText("#ai-old-title-count", `${oldTitle.length} / 200`);
    setText("#ai-title-count", `${title.length} / 75`);
    setText("#ai-highlights-count", `${highlights.length} / 125`);
    setText("#ai-description-count", `${description.length} 字符`);
    setText("#ai-keywords-count", `${aiUtf8Bytes(keywords)} / 249 bytes`);
  }
  
  function renderAiListingCopy(listing) {
    if (!listing) return;
    currentAiListingCopy = listing;
    const oldTitle = root.querySelector("#ai-listing-old-title");
    const title = root.querySelector("#ai-listing-title");
    const highlights = root.querySelector("#ai-listing-highlights");
    const description = root.querySelector("#ai-listing-description");
    const keywords = root.querySelector("#ai-listing-keywords");
    if (oldTitle) oldTitle.value = String(listing.oldTitle || "").slice(0, 200);
    if (title) title.value = String(listing.title || "").slice(0, 75);
    if (highlights) highlights.value = String(listing.highlights || "").slice(0, 125);
    if (description) description.value = listing.description;
    if (keywords) keywords.value = listing.keywords;
    const bullets = root.querySelector("#ai-listing-bullets");
    if (bullets) {
      bullets.innerHTML = listing.bullets.map((bullet, index) => `
        <label class="ai-listing-bullet">
          <i>${index + 1}</i>
          <textarea rows="3" data-ai-bullet-index="${index}" aria-label="五点描述 ${index + 1}">${escapeHtml(bullet)}</textarea>
        </label>
      `).join("");
    }
    renderAiProductLineState(listing.form.productLine);
    storage.setItem(AI_WORKFLOW_STORAGE_KEY, JSON.stringify(listing.form));
    updateAiListingCounts();
    const market = aiWorkflowMarkets[listing.form.market] || aiWorkflowMarkets.US;
    setText("#ai-workflow-status", `已生成${market.label}文案 · 可直接修改`);
  }
  
  function exportAiImageWorkflow() {
    const workflow = currentAiImageWorkflow;
    if (!workflow) {
      setText("#ai-workflow-status", "请先生成工作流");
      return;
    }
    const form = workflow.form;
    const content = [
      `# ${form.productName} AI 图片工作流`, "",
      `- 产品线：${workflow.productLine.name}`,
      `- 产品类目：${form.category || "-"}`,
      `- 目标站点：${workflow.market.label}`,
      `- 目标人群：${form.audience || "-"}`,
      `- 视觉风格：${workflow.style.label}`,
      `- 生成时间：${new Date(workflow.generatedAt).toLocaleString("zh-CN", { hour12: false })}`, "",
      "## 核心卖点", ...workflow.features.map((item) => `- ${item}`), "",
      "## 套图文案与画面", "", aiWorkflowCopyText(workflow, "copy"), "",
      "## 生图提示词", "", aiWorkflowCopyText(workflow, "prompt"),
    ].join("\n");
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `${form.productName.replace(/[\\/:*?"<>|]/g, "-")}-AI图片工作流.md`);
    setText("#ai-workflow-status", "交付单已导出");
  }
  
  function setupAiImageWorkflow() {
    renderAiProductImages();
    bind(root, "#ai-generate-workflow", "click", generateAiImageWorkflow);
    bind(root, "#ai-load-example", "click", loadAiWorkflowExample);
    bind(root, "#ai-product-line", "change", (event) => applyAiProductLineTemplate(event.target.value, { keepMarket: true }));
    bind(root, "#ai-reset-workflow", "click", resetAiImageWorkflow);
    bind(root, "#ai-product-image-upload", "click", () => root.querySelector("#ai-product-images")?.click());
    bind(root, "#ai-product-images", "change", handleAiProductImageSelection);
    bind(root, "#view-ai-image-workflow", "click", (event) => {
      const removeImageButton = closestTarget(event, "[data-ai-remove-image]");
      if (removeImageButton) {
        removeAiProductImage(removeImageButton.dataset.aiRemoveImage);
        return;
      }
      const copyButton = closestTarget(event, "[data-ai-listing-copy]");
      if (copyButton) {
        const type = copyButton.dataset.aiListingCopy;
        const labels = { oldTitle: "旧标题", title: "新标题", highlights: "商品亮点", bullets: "五点描述", description: "产品描述", keywords: "后台搜索关键词" };
        copyAiWorkflowText(aiListingCopyText(type), `${labels[type] || "文案"}已复制`);
      }
      if (closestTarget(event, "#ai-copy-all-listing")) copyAiWorkflowText(aiListingCopyText("all"), "全部 Listing 文案已复制");
    });
    bind(root, "#view-ai-image-workflow", "input", (event) => {
      if (event.target.matches("#ai-listing-old-title")) event.target.value = event.target.value.slice(0, 200);
      if (event.target.matches("#ai-listing-title")) event.target.value = event.target.value.slice(0, 75);
      if (event.target.matches("#ai-listing-highlights")) event.target.value = event.target.value.slice(0, 125);
      if (event.target.matches("#ai-listing-old-title, #ai-listing-title, #ai-listing-highlights, #ai-listing-description, #ai-listing-keywords")) updateAiListingCounts();
    });
    try {
      const saved = JSON.parse(storage.getItem(AI_WORKFLOW_STORAGE_KEY) || "null");
      if (saved?.productName) {
        setAiWorkflowFormData(saved);
        renderAiListingCopy(buildAiListingCopy(saved));
        return;
      }
    } catch {
      storage.removeItem(AI_WORKFLOW_STORAGE_KEY);
    }
    applyAiProductLineTemplate("soccer-robots");
  }

  return {
    setupAiImageWorkflow,
  };
}
