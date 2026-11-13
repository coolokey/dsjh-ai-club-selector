/**
 * 桃園市「AI好幫手：智慧協作工具徵選與應用計畫」特優參賽旗艦系統
 * 專案名稱：AI智慧社團選社與適性導航系統 (AI Club Selection & Adaptive Guidance System)
 * 服務學校：桃園市立大溪國民中學 ｜ 開發團隊：游貿仁 老師
 *
 * 全新升級亮點（特優首獎規格）：
 * 1. 📧 錄取通知同步發送信箱 (HTML Email Notification)：學生即時選社或分發完成自動發送個人錄取通知函。
 * 2. 🤖 Gemini 1.5 結構化適性顧問：嚴格白名單防幻覺、PII 個資遮蔽、108 課綱核心素養導航。
 * 3. 👥 班級分散防抱團機制：限制單一社團同班上限人數（預設 4 人），杜絕私密派對與秩序失控。
 * 4. 🛡️ 企業級資安與 Token 權限隔離：隱藏資料庫 URL、後台 Session Token 防越權、等冪性防重複報錯。
 * 5. ⚡ 2D 陣列批次分發演算法：徹底排除 GAS 30 秒超時，修復重複分發人數歸零 Bug，支援抽籤序號追蹤。
 * 6. 👨‍🏫 導師即時查核專區：班級名單視覺化＋一鍵複製 LINE 催繳文案。
 * 7. 📑 點名簽到單含健康警示：保留 GID 連結，標註重大病史與校園緊急聯絡分機。
 * 8. 🌐 前後端分離 API：doPost 白名單閘道，GitHub Pages 前端可直接讀寫 Google 試算表；後台可管理社團資料。
 */

// ==================== 系統設定與常數 ====================
const CONFIG = {
  DEFAULT_PASSWORD: 'admin888',
  DEFAULT_TITLE: '大溪國中 AI 智慧社團選社系統',
  GEMINI_MODEL: 'gemini-1.5-flash',
  LOCK_TIMEOUT_MS: 30000,
  MAX_PER_CLASS_PER_CLUB: 4, // 單一社團各班人數上限（防抱團）
  DEFAULT_SALT: 'DSJH_SECURE_SALT_2026',
  SESSION_EXPIRE_SEC: 7200, // Session Token 效期 2 小時
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_SECONDS: 900, // 連續登入失敗 5 次鎖定 15 分鐘
  // 預設綁定的 Google 試算表資料庫（獨立指令碼無「目前綁定試算表」時使用；他校複製請改成自己的 ID，或在指令碼屬性設定 SPREADSHEET_ID）
  DEFAULT_SPREADSHEET_ID: '186jh-V-z7reYO9Y2ybJJhugITiz2pqqmH9pLheDayJ4',
  // 成績查詢系統（https://coolokey.github.io/dsjh-score/）後台試算表 ID：僅供唯讀匯入學生名單與導師名單，絕不修改來源
  SCORE_SOURCE_SPREADSHEET_ID: '1cLrFMTA-gXTDQFKzW2E1C186_WJ0SuwMhky1_RL2Q3U',
  API_VERSION: '2026.11-pages-api',
  REQUIRED_SHEETS: ['社團設定', '學生名單', '導師名單', '管理者名單', '系統設定', '社團點名簽到冊']
};

// 全域執行週期單例快取，避免重複 openById
let _cachedSpreadsheet = null;

// ==================== Web App 進入點 ====================
function doGet() {
  ensureSheetExists();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(getSystemSettings().title || CONFIG.DEFAULT_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==================== 前後端分離 API 閘道（GitHub Pages ⇄ Google 試算表） ====================
/**
 * 前端（GitHub Pages）以 fetch POST (text/plain，避免 CORS 預檢) 呼叫：{ fn: '函式名稱', args: [...] }
 * 僅開放下列白名單函式；後台類函式仍由各自的 Session Token／導師通行碼把關。
 */
const API_ROUTES_ = {
  getServerStatus: getServerStatus,
  getSystemSettings: getSystemSettings,
  getClassList: getClassList,
  verifyAndGetClubs: verifyAndGetClubs,
  changeStudentPassword: changeStudentPassword,
  submitSelection: submitSelection,
  submitPreferences: submitPreferences,
  cancelSelection: cancelSelection,
  aiConsultantRecommend: aiConsultantRecommend,
  loginTeacher: loginTeacher,
  changeTeacherPassword: changeTeacherPassword,
  getHomeroomClassData: getHomeroomClassData,
  loginAdmin: loginAdmin,
  changeAdminPassword: changeAdminPassword,
  getAdminDashboardData: getAdminDashboardData,
  saveSystemSettings: saveSystemSettings,
  saveClub: saveClub,
  deleteClub: deleteClub,
  seedCanonicalClubs: seedCanonicalClubs,
  getPublicClubCatalog: getPublicClubCatalog,
  runAiSmartAllocation: runAiSmartAllocation,
  batchSendAllocationEmails: batchSendAllocationEmails,
  exportAttendanceSheets: exportAttendanceSheets,
  generateClubDocManual: generateClubDocManual,
  getSpreadsheetAudit: getSpreadsheetAudit,
  cleanupUnusedSheets: cleanupUnusedSheets,
  formatAllSheetsLayout: formatAllSheetsLayout,
  syncUsersFromScoreSystem: syncUsersFromScoreSystem
};

function doPost(e) {
  let payload;
  try {
    ensureSheetExists();
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const req = JSON.parse(raw);
    const fn = String(req.fn || '');
    if (!Object.prototype.hasOwnProperty.call(API_ROUTES_, fn)) {
      throw new Error('404 Unknown API: ' + fn.slice(0, 40));
    }
    const args = Array.isArray(req.args) ? req.args : [];
    if (args.length > 8) throw new Error('400 Too many arguments');
    payload = { ok: true, result: API_ROUTES_[fn].apply(null, args) };
  } catch (err) {
    payload = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 連線健康檢查：同時驗證資料庫（試算表）可正常開啟 */
function getServerStatus() {
  const settings = getSystemSettings(); // 內含 ensureSheetExists，會實際開啟試算表
  return {
    status: 'success',
    dbConnected: true,
    version: CONFIG.API_VERSION,
    mode: settings.mode,
    title: settings.title
  };
}

// ==================== 試算表初始化與資料庫結構 ====================
function getSpreadsheet() {
  if (_cachedSpreadsheet) return _cachedSpreadsheet;

  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SPREADSHEET_ID');
  if (sheetId) {
    try {
      _cachedSpreadsheet = SpreadsheetApp.openById(sheetId);
      return _cachedSpreadsheet;
    } catch (e) {
      console.warn('無法開啟設定的試算表 ID，嘗試取得當前綁定或新建：' + e.message);
    }
  }

  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      props.setProperty('SPREADSHEET_ID', active.getId());
      _cachedSpreadsheet = active;
      return _cachedSpreadsheet;
    }
  } catch (e) {}

  if (CONFIG.DEFAULT_SPREADSHEET_ID) {
    try {
      _cachedSpreadsheet = SpreadsheetApp.openById(CONFIG.DEFAULT_SPREADSHEET_ID);
      props.setProperty('SPREADSHEET_ID', CONFIG.DEFAULT_SPREADSHEET_ID);
      return _cachedSpreadsheet;
    } catch (e) {
      console.warn('無法開啟預設試算表，將建立新的資料庫：' + e.message);
    }
  }

  const newSheet = SpreadsheetApp.create('大溪國中AI社團選社資料庫');
  props.setProperty('SPREADSHEET_ID', newSheet.getId());
  _cachedSpreadsheet = newSheet;
  return _cachedSpreadsheet;
}

/**
 * 跨校多元熱門社團設定（涵蓋 108 課綱彈性學習課程與聯課活動六大領域，共 28 社，名額總計約 700 席）
 */
const CANONICAL_CLUBS = [
  // 體育競技（7 社）
  ['熱血籃球戰術社', 30, 0, '陳建勳 教練', '風雨球場A', '基礎運球技巧、傳切配合、團隊防守跑位、半場戰術演練與分組實戰對抗，鍛鍊心肺體能與團隊默契。', '請穿著運動服裝、攜帶毛巾與自備籃球鞋', '體育競技'],
  ['羽球活力雙打社', 26, 0, '林志祥 老師', '學生活動中心羽球場', '正反手發球、網前小球切球、後場平高球與殺球跑位技巧，加強雙打走位默契與敏捷反應能力。', '自備羽球拍與運動鞋，耗損羽球由公費提供', '體育競技'],
  ['桌球技巧精進社', 24, 0, '郭文彬 老師', '桌球地下防空避難室', '正反手推擋、弧圈球拉旋、發球落點變化與單雙打步法訓練，培養手眼協調與瞬間專注力。', '需自備桌球拍（膠皮不限），練習球由社團提供', '體育競技'],
  ['競技排球與防守社', 26, 0, '黃俊傑 老師', '體育館排球場', '低手接發球、高手舉球配球、扣球步伐與陣形攔網訓練，著重團隊溝通呼應與不放棄救球精神。', '請穿著運動服裝與室內球鞋，建議自備護膝', '體育競技'],
  ['流行街舞與律動社', 25, 0, 'Amy 舞蹈教練', '韻律舞蹈教室（鏡面教室）', 'Hip-Hop 基礎律動、Popping 震點定點練習、流行 K-Pop MV 舞步拆解與成果排舞展演。', '穿著寬鬆舒適服裝與乾淨平底球鞋，無舞蹈基礎可', '體育競技'],
  ['跆拳防身自衛術社', 24, 0, '張教練（黑帶四段）', '柔道跆拳訓練教室', '基本踢腿防護、品勢步伐、防身脫困技巧與體能反應訓練，培養尊師重道品格與自我防護意識。', '穿著輕便運動服或道服，備有公用腳靶防具', '體育競技'],
  ['五人制足球技巧社', 26, 0, '周教練', '操場草皮區／風雨球場B', '盤帶傳球控球技術、短傳滲透小組配合、守門撲救反應與小場地高強度對抗，強化下肢爆發力。', '穿著運動鞋或平底足球鞋（禁止金屬鋼釘鞋），自備長襪護脛', '體育競技'],

  // 科技創客（4 社）
  ['AI機器人創客社', 22, 0, '李宗翰 組長', '科技創客教室', '結合 Arduino 感測器、Micro:bit 智慧控制與簡易 AI 影像辨識，親手組裝感應智能避障小車與物聯網裝置。', '提供公用電腦與套件，耗材材料費每學期 200 元', '科技創客'],
  ['Python與演算法程式社', 25, 0, '鄭組長', '電腦教室一', '從圖形化 Blocky 銜接至 Python 核心語法，實作文字冒險遊戲、自動化爬蟲與邏輯解題思維訓練。', '無需程式基礎，使用學校電腦教室設備，請自備隨身碟存檔', '科技創客'],
  ['3D列印與立體模型創客社', 20, 0, '劉老師', '生活科技木工創客教室', 'Tinkercad 3D 建模設計、3D 列印切片參數操作、雷射雕刻雷切鑰匙圈與機構齒輪動態手作。', '作品可帶回，耗材費（PLA線材與密集板）每人 180 元', '科技創客'],
  ['無人機飛行與空拍攝影社', 20, 0, '許組長', '科技研討室與中庭草坪', '微型室內無人機飛行原理、手眼協調操控穿越障礙賽道、安全空拍法規與手機縮時縮影運鏡。', '校方提供公用訓練機，需具備高度安全操作紀律', '科技創客'],

  // 視覺藝術（5 社）
  ['數位動漫與繪畫社', 25, 0, '王靜儀 老師', '電腦教室二', '專業電繪板感壓操作、動漫角色頭身骨架比例、光影層次上色、四格分鏡漫畫創作與個人插畫作品集。', '使用教室專業繪圖板與繪圖軟體，材料無額外收費', '視覺藝術'],
  ['手作黏土與文創工藝社', 22, 0, '陳敏慧 老師', '美術教室一', '輕黏土仿真甜點、樹脂飾品手作、環保蝶谷巴特拼貼提袋與文青風手作杯墊，享受手作療癒時光。', '材料包（含黏土、五金吊飾、黏著劑）每人 150 元', '視覺藝術'],
  ['水彩美學與素描寫生社', 22, 0, '簡老師', '美術教室二', '鉛筆素描明暗排線、校園景物靜物透視寫生、透明水彩渲染與混色疊色技法，打下扎實美術底子。', '需自備水彩用具（水彩餅或管狀、水彩筆、調色盤、洗筆筒）', '視覺藝術'],
  ['經典書法與水墨文創社', 22, 0, '曾老師', '國學書法專用教室', '楷書隸書筆法運筆氣韻、水墨濃淡乾濕技法、創意春聯揮毫與扇面題字文創實作，陶冶心性沉靜氣質。', '需自備大楷、中楷毛筆各一支，宣紙與墨汁由社團備置', '視覺藝術'],
  ['皮革工藝與生活布縫社', 23, 0, '何老師', '家政工藝教室', '植物鞣皮革基礎打孔、雙針鞍式手縫、皮邊修飾打磨，親手完成識別證套、零錢包與刺繡帆布小包。', '皮革材料包與縫紉針線組每人 160 元', '視覺藝術'],

  // 音樂表演（5 社）
  ['烏克麗麗與吉他彈唱社', 24, 0, '林家宏 老師', '音樂教室B', '由簡入繁學習三和弦切換、民謠節奏刷法、指彈撥弦與最新流行華語流行金曲彈唱，自信登台表演。', '強烈建議自備吉他或烏克麗麗，教室提供 8 把備用琴供輪流練習', '音樂表演'],
  ['熱門流行樂團與合奏社', 20, 0, '潘老師', '熱音社團練室（隔音間）', '電吉他破音特效、電貝斯低音律動、流行爵士鼓重音節奏與鍵盤合成器配器，合奏流行搖滾曲目。', '需具備基礎樂器彈奏經驗者為佳，備有公用音箱與專業爵士鼓', '音樂表演'],
  ['管樂合奏與長笛小號初階社', 25, 0, '蕭老師', '管樂團大合奏室', '長笛、單簧管、小號、長號吹奏嘴型呼吸與指法訓練，認識五線譜與齊奏重奏合聲之美。', '學校管樂團備有公用管樂器借用，需自備個人專用吹嘴（或簧片）', '音樂表演'],
  ['節奏打擊樂與木箱鼓社', 20, 0, '高老師', '音樂教室A', '木箱鼓（Cajon）打法手勢、非洲鼓節奏呼應、動態杯子打擊樂（Cup Song）與節奏合奏重擊震撼。', '使用教室公用木箱鼓與非洲鼓，無打擊基礎亦可快速上手', '音樂表演'],
  ['戲劇表演與舞台主持社', 21, 0, '蔡老師', '多功能演藝階梯教室', '即興表演練習、口條發聲發音投射、肢體開發模仿、情境短劇排演與大型校園活動舞台主持技巧培訓。', '喜愛說話、表達或想要突破害羞內向者皆非常歡迎，無材料費', '音樂表演'],

  // 策略邏輯與語文思辨（4 社）
  ['桌遊與邏輯推理社', 28, 0, '張育誠 老師', '七年級多功能教室', '精選德式策略資源管理桌遊（卡卡頌、卡坦島）、邏輯劇本解謎與陣營心機推理，激發批判性思考。', '學校購置豐富全新正版桌遊盒裝，無須自備道具，愛好思考互動者佳', '策略邏輯'],
  ['棋藝研究社（象棋、圍棋與西洋棋）', 26, 0, '洪老師（業餘段位棋士）', '靜態閱覽教室', '布局定式解析、中局算子博弈、殘局攻殺戰術演練與社內循環定段賽，培養沉著冷靜與全局推演眼界。', '教室備有標準棋盤棋具，無基礎亦可自基礎棋規學起', '策略邏輯'],
  ['日語生活基礎與動漫文化社', 25, 0, '佐藤老師 / 林老師', '語言研習教室', '平假名片假名五十音記憶法、生活日常問候、旅遊點餐情境模擬、熱門動漫主題曲歌詞賞析與日本文化探索。', '印製專屬日語自編手冊，免教材費', '語文思辨'],
  ['英語電影賞析與情境對話社', 25, 0, '外師 + 英語科輔導教師', '視聽階梯演講廳', '精選歐美得獎動畫與青少年電影經典片段，解析道地口語流行俚語、角色扮演情境對話與跨文化分享。', '全程多媒體放映與情境互動，無材料費', '語文思辨'],

  // 自然實驗與生活服務（3 社）
  ['趣味生活科學實驗社', 24, 0, '黃柏翰 老師', '理化實驗室三', '生活化學趣味顯色、大氣壓力水火箭試射、分子料理晶球、乾冰仙境與磁浮陀螺，在動手中驗證科學奧秘。', '需穿著棉質長褲與防護實驗圍裙，材料費 150 元', '自然實驗'],
  ['童軍野外求生與探索社', 26, 0, '李木榮 團長（童軍木章持有人）', '童軍露營營地／童軍教室', '實用繩結編織、雙旗密碼信號、野外無具野炊、方位指北針定位定向越野與急救包紮包紮實用技能。', '戶外活動需具備團隊紀律，自備童軍繩（學校亦可代購 50 元）', '生活服務'],
  ['校園新聞播報與自媒體攝影社', 22, 0, '趙組長', '校園主播攝影棚', '校園熱門話題新聞採訪、單眼相機與手機運鏡構圖技巧、剪映/CapCut 剪輯音效配樂與大溪國中影音校刊製作。', '無經驗可，適合喜愛表達、拍照、剪片或幕後技術探索者', '生活服務']
];

function ensureAdminCredentialsSheet_(ss) {
  const props = PropertiesService.getScriptProperties();
  let adminSheet = ss.getSheetByName('管理者名單');
  let currentPwd = '';

  if (adminSheet && adminSheet.getLastRow() >= 2) {
    const rows = adminSheet.getDataRange().getDisplayValues();
    for (let r = 1; r < rows.length; r++) {
      if (String(rows[r][0] || '').trim().toLowerCase() === 'admin') {
        currentPwd = String(rows[r][2] || '').trim();
        break;
      }
    }
  }

  if (!currentPwd) {
    const cfgSheet = ss.getSheetByName('系統設定');
    if (cfgSheet && cfgSheet.getLastRow() >= 2) {
      const cRows = cfgSheet.getDataRange().getDisplayValues();
      for (let r = 1; r < cRows.length; r++) {
        if (String(cRows[r][0] || '').trim() === 'ADMIN_PASSWORD') {
          currentPwd = String(cRows[r][1] || '').trim();
          break;
        }
      }
    }
  }

  if (!currentPwd) {
    currentPwd = props.getProperty('ADMIN_PASSWORD') || CONFIG.DEFAULT_PASSWORD;
  }

  // 1. 確保「管理者名單」工作表存在 (比照成績查詢系統)
  if (!adminSheet) {
    adminSheet = ss.insertSheet('管理者名單');
    adminSheet.appendRow(['帳號', '姓名', '密碼', '說明']);
    adminSheet.getRange(1, 1, 1, 4).setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    adminSheet.appendRow(['admin', '學務處訓育組', currentPwd, '系統最高管理權限']);
    const rngPwd = adminSheet.getRange(2, 3);
    if (typeof rngPwd.setNumberFormat === 'function') rngPwd.setNumberFormat('@');
    const rngAcc = adminSheet.getRange(2, 1);
    if (typeof rngAcc.setNumberFormat === 'function') rngAcc.setNumberFormat('@');
    formatSheetLayout_(adminSheet);
  } else {
    const rows = adminSheet.getDataRange().getDisplayValues();
    let hasAdmin = false;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim().toLowerCase() === 'admin') {
        hasAdmin = true;
        break;
      }
    }
    if (!hasAdmin) {
      adminSheet.appendRow(['admin', '學務處訓育組', currentPwd, '系統最高管理權限']);
      const lr = adminSheet.getLastRow();
      const rngPwd = adminSheet.getRange(lr, 3);
      if (typeof rngPwd.setNumberFormat === 'function') rngPwd.setNumberFormat('@');
      const rngAcc = adminSheet.getRange(lr, 1);
      if (typeof rngAcc.setNumberFormat === 'function') rngAcc.setNumberFormat('@');
    }
  }

  // 2. 確保「系統設定」內存在 ADMIN_PASSWORD 列
  const cfgSheet = ss.getSheetByName('系統設定');
  if (cfgSheet) {
    const cRows = cfgSheet.getDataRange().getDisplayValues();
    let hasCfgPwd = false;
    for (let r = 1; r < cRows.length; r++) {
      if (String(cRows[r][0] || '').trim() === 'ADMIN_PASSWORD') {
        hasCfgPwd = true;
        break;
      }
    }
    if (!hasCfgPwd) {
      cfgSheet.appendRow(['ADMIN_PASSWORD', currentPwd, '學務處行政管理密碼（管理者可直接於「管理者名單」工作表查看與修改）']);
      const lr = cfgSheet.getLastRow();
      const rng = cfgSheet.getRange(lr, 2);
      if (typeof rng.setNumberFormat === 'function') rng.setNumberFormat('@');
    }
  }

  props.setProperty('ADMIN_PASSWORD', currentPwd);
}

function seedCanonicalClubsToSheet_(ss, force) {
  let clubSheet = ss.getSheetByName('社團設定');
  if (!clubSheet) {
    clubSheet = ss.insertSheet('社團設定');
  }

  const existingRows = clubSheet.getLastRow() > 0 ? clubSheet.getDataRange().getDisplayValues() : [];
  const existingMap = {};
  for (let i = 1; i < existingRows.length; i++) {
    const name = String(existingRows[i][0] || '').trim();
    if (name) {
      existingMap[name] = {
        limit: parseInt(existingRows[i][1], 10) || 0,
        current: parseInt(existingRows[i][2], 10) || 0,
        teacher: existingRows[i][3] || '',
        location: existingRows[i][4] || '',
        desc: existingRows[i][5] || '',
        req: existingRows[i][6] || '',
        cat: existingRows[i][7] || ''
      };
    }
  }

  const totalAssigned = Object.values(existingMap).reduce((s, c) => s + (c.current || 0), 0);
  if (!force && existingRows.length >= 28 && totalAssigned > 0) {
    return { status: 'skipped', message: '已有選社學生且社團已達規格，跳過自動覆蓋。' };
  }

  const headers = ['社團名稱', '人數上限', '已錄取人數', '授課教師', '活動地點', '社團簡介', '先備要求與材料費', '社團類別'];
  const nextRows = [headers];

  CANONICAL_CLUBS.forEach(c => {
    const name = c[0];
    const prev = existingMap[name];
    if (prev && !force) {
      nextRows.push([
        name,
        prev.limit || c[1],
        prev.current || 0,
        prev.teacher || c[3],
        prev.location || c[4],
        prev.desc || c[5],
        prev.req || c[6],
        prev.cat || c[7]
      ]);
      delete existingMap[name];
    } else {
      nextRows.push([c[0], c[1], (prev && prev.current) || 0, c[3], c[4], c[5], c[6], c[7]]);
      delete existingMap[name];
    }
  });

  Object.keys(existingMap).forEach(k => {
    const ex = existingMap[k];
    nextRows.push([k, ex.limit, ex.current, ex.teacher, ex.location, ex.desc, ex.req, ex.cat]);
  });

  if (typeof clubSheet.clearContents === 'function') clubSheet.clearContents();
  clubSheet.getRange(1, 1, nextRows.length, 8).setValues(nextRows);
  clubSheet.getRange(1, 1, 1, 8).setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  formatSheetLayout_(clubSheet);

  return { status: 'success', count: nextRows.length - 1 };
}

/**
 * 確保三大核心工作表完整存在，初次執行時自動灌入示範資料
 */
function ensureSheetExists() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('IS_INITIALIZED') === 'true') {
    if (props.getProperty('ADMIN_SHEET_SYNC_V') !== '20261113_admin888') {
      try {
        setAdminPasswordInSpreadsheet_(CONFIG.DEFAULT_PASSWORD);
        props.setProperty('ADMIN_SHEET_SYNC_V', '20261113_admin888');
      } catch (e) {
        console.warn('Auto admin password sync skipped: ' + e.message);
      }
    }
    if (props.getProperty('ADMIN_SHEET_V') !== '1') {
      try {
        ensureAdminCredentialsSheet_(getSpreadsheet());
        props.setProperty('ADMIN_SHEET_V', '1');
      } catch (e) {
        console.warn('Auto admin sheet ensure skipped: ' + e.message);
      }
    }
    if (props.getProperty('CANONICAL_CLUBS_V') !== '28') {
      try {
        seedCanonicalClubsToSheet_(getSpreadsheet(), false);
        props.setProperty('CANONICAL_CLUBS_V', '28');
      } catch (e) {
        console.warn('Auto canonical clubs seed skipped: ' + e.message);
      }
    }
    if (props.getProperty('SCORE_SYNC_V') !== '20261113_student_list') {
      try {
        const syncRes = syncDirectoryFromScoreDb_(getSpreadsheet());
        if (syncRes && syncRes.status === 'success') {
          props.setProperty('SCORE_SYNC_V', '20261113_student_list');
        }
      } catch (e) {
        console.warn('Auto score directory sync skipped: ' + e.message);
      }
    }
    if (props.getProperty('SHEET_LAYOUT_V') !== '1') {
      try {
        formatAllSheets_(getSpreadsheet());
      } catch (e) {
        console.warn('Auto layout format skipped: ' + e.message);
      }
    }
    return; // 已初始化完成，跳過檢查以提升效能
  }

  const ss = getSpreadsheet();

  // 1. 社團設定表（初次初始化即載入 28 所跨校熱門多元社團）
  let clubSheet = ss.getSheetByName('社團設定');
  if (!clubSheet || clubSheet.getLastRow() <= 1) {
    seedCanonicalClubsToSheet_(ss, true);
  }

  // 2. 學生名單表（直接以成績系統「學生名單」取代原學生名冊）
  let studentSheet = ss.getSheetByName('學生名單');
  if (!studentSheet) {
    const oldRoster = ss.getSheetByName('學生名冊');
    if (oldRoster) {
      try {
        oldRoster.setName('學生名單');
        studentSheet = oldRoster;
      } catch (e) {
        studentSheet = ss.insertSheet('學生名單');
      }
    } else {
      studentSheet = ss.insertSheet('學生名單');
    }
  }

  // 確保舊「學生名冊」分頁若仍存在則予以刪除
  const legacyRoster = ss.getSheetByName('學生名冊');
  if (legacyRoster && ss.getSheetByName('學生名單') && legacyRoster !== ss.getSheetByName('學生名單')) {
    try { ss.deleteSheet(legacyRoster); } catch (e) {}
  }

  if (studentSheet.getLastRow() <= 1) {
    studentSheet.clearContents();
    studentSheet.appendRow([
      '學號', '姓名', '班級', '座號', '身分證後四碼', '出生月日', '密碼',
      '學生Email', '第一志願', '第二志願', '第三志願', '錄取社團', '選填時間',
      '分發備註', '保障身分鎖定', '健康安全提醒'
    ]);
    studentSheet.getRange(1, 1, 1, 16).setBackground('#0f9d58').setFontColor('#ffffff').setFontWeight('bold');

    const demoStudents = [
      ['11470101', '王大明', '701', '01', '6789', '0101', '67890101', 'daxi_70101@example.com', '', '', '', '', '', '', '', ''],
      ['11470102', '李小美', '701', '02', '6789', '0202', '67890202', 'daxi_70102@example.com', '', '', '', '', '', '', '', ''],
      ['11470103', '張志豪', '701', '03', '6789', '0303', '67890303', 'daxi_70103@example.com', '', '', '', '', '', '', '校隊保障(籃球)', ''],
      ['11470104', '林佩君', '701', '04', '6789', '0404', '67890404', 'daxi_70104@example.com', '', '', '', '', '', '', '', '氣喘，劇烈運動需注意'],
      ['11470201', '陳建宏', '702', '01', '6789', '0505', '67890505', 'daxi_70201@example.com', '', '', '', '', '', '', '', ''],
      ['11470202', '黃雅婷', '702', '02', '6789', '0606', '67890606', 'daxi_70202@example.com', '', '', '', '', '', '', '', ''],
      ['11470203', '吳宗憲', '702', '03', '6789', '0707', '67890707', 'daxi_70203@example.com', '', '', '', '', '', '', '', ''],
      ['11470204', '蔡依林', '702', '04', '6789', '0808', '67890808', 'daxi_70204@example.com', '', '', '', '', '', '', '', '']
    ];
    studentSheet.getRange(2, 1, demoStudents.length, 16).setValues(demoStudents);
  }

  // 2b. 導師名單表（比照成績系統 教師帳號／密碼／負責班級／首次登入標記）
  let teacherSheet = ss.getSheetByName('導師名單');
  if (!teacherSheet) {
    teacherSheet = ss.insertSheet('導師名單');
    teacherSheet.appendRow(['教師帳號', '教師姓名', '負責班級', '密碼', '首次登入標記', '公務信箱']);
    teacherSheet.getRange(1, 1, 1, 6).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
    const demoTeachers = [
      ['tf51056', '張雅琪 導師', '7年1班', '701701', true, 'tf51056@dsjh.tyc.edu.tw'],
      ['tf51032', '李俊毅 導師', '7年2班', '702702', true, 'tf51032@dsjh.tyc.edu.tw']
    ];
    teacherSheet.getRange(2, 1, demoTeachers.length, 6).setValues(demoTeachers);
  }

  // 2c. 管理者名單表 (儲存管理員帳密至試算表)
  ensureAdminCredentialsSheet_(ss);

  // 3. 系統設定表
  let configSheet = ss.getSheetByName('系統設定');
  if (!configSheet) {
    configSheet = ss.insertSheet('系統設定');
    configSheet.appendRow(['設定項目', '設定值', '說明']);
    configSheet.getRange(1, 1, 1, 3).setBackground('#f4b400').setFontColor('#ffffff').setFontWeight('bold');

    const defaultConfigs = [
      ['SYSTEM_TITLE', CONFIG.DEFAULT_TITLE, '系統顯示標題'],
      ['SELECTION_MODE', 'instant', '選社模式: instant(即時搶名額) / preferences(多志願序分發)'],
      ['OPEN_TIME', '', '開放時間 (例如: 2026-09-01T08:00)'],
      ['CLOSE_TIME', '', '截止時間 (例如: 2026-09-30T23:59)'],
      ['AI_ADVISOR_ENABLED', 'true', '是否開啟 Gemini 智慧選社顧問 (true/false)'],
      ['MAX_PREFERENCES', '3', '多志願模式下可選志願數量'],
      ['MAX_PER_CLASS_PER_CLUB', String(CONFIG.MAX_PER_CLASS_PER_CLUB), '單一社團各班人數上限（防抱團）'],
      ['EMAIL_NOTIFICATION_ENABLED', 'true', '是否啟用錄取結果同步寄送信箱 (true/false)'],
      ['ADMIN_PASSWORD', CONFIG.DEFAULT_PASSWORD, '學務處行政管理密碼（管理者可直接於「管理者名單」工作表查看與修改）']
    ];
    configSheet.getRange(2, 1, defaultConfigs.length, 3).setValues(defaultConfigs);
  }

  const defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 3) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  try {
    const syncRes = syncDirectoryFromScoreDb_(ss);
    if (syncRes && syncRes.status === 'success') {
      props.setProperty('SCORE_SYNC_V', '1');
    }
  } catch (e) {
    console.warn('Initial score directory sync skipped: ' + e.message);
  }

  try {
    formatAllSheets_(ss);
  } catch (e) {
    console.warn('Initial layout format skipped: ' + e.message);
  }

  props.setProperty('ADMIN_SHEET_V', '1');
  props.setProperty('CANONICAL_CLUBS_V', '28');
  props.setProperty('IS_INITIALIZED', 'true');
}

// ==================== 系統設定存取 API (落實個資資安隔離) ====================
function getSystemSettings() {
  ensureSheetExists();
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('系統設定');
  const data = sheet.getDataRange().getValues();

  const settings = {
    title: CONFIG.DEFAULT_TITLE,
    mode: 'instant',
    openTime: '',
    closeTime: '',
    aiAdvisorEnabled: true,
    maxPreferences: 3,
    maxPerClass: CONFIG.MAX_PER_CLASS_PER_CLUB,
    emailNotificationEnabled: true
    // 🛡️ 資安修復：絕不在公開 API 中包含 spreadsheetUrl！
  };

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const val = String(data[i][1]);
    if (key === 'SYSTEM_TITLE') settings.title = val;
    else if (key === 'SELECTION_MODE') settings.mode = val;
    else if (key === 'OPEN_TIME') settings.openTime = val;
    else if (key === 'CLOSE_TIME') settings.closeTime = val;
    else if (key === 'AI_ADVISOR_ENABLED') settings.aiAdvisorEnabled = (val === 'true');
    else if (key === 'MAX_PREFERENCES') settings.maxPreferences = parseInt(val, 10) || 3;
    else if (key === 'MAX_PER_CLASS_PER_CLUB') settings.maxPerClass = parseInt(val, 10) || CONFIG.MAX_PER_CLASS_PER_CLUB;
    else if (key === 'EMAIL_NOTIFICATION_ENABLED') settings.emailNotificationEnabled = (val === 'true');
  }

  return settings;
}

// ==================== 管理員權限驗證攔截器（密碼直接存於試算表「管理者名單」與「系統設定」） ====================
function getAdminPassword_() {
  try {
    const ss = getSpreadsheet();
    // 1. 優先從「管理者名單」工作表讀取 (比照成績查詢系統)
    let adminSheet = ss.getSheetByName('管理者名單');
    if (!adminSheet) {
      try {
        ensureAdminCredentialsSheet_(ss);
        adminSheet = ss.getSheetByName('管理者名單');
      } catch (e) {}
    }
    if (adminSheet && adminSheet.getLastRow() >= 2) {
      const rows = adminSheet.getDataRange().getDisplayValues();
      const header = rows[0] || [];
      let accCol = 0, pwdCol = 2;
      for (let c = 0; c < header.length; c++) {
        const h = String(header[c] || '').trim();
        if (h === '帳號') accCol = c;
        else if (h === '密碼') pwdCol = c;
      }
      for (let r = 1; r < rows.length; r++) {
        const acc = String(rows[r][accCol] || '').trim().toLowerCase();
        if (acc === 'admin') {
          const pwd = String(rows[r][pwdCol] || '').trim();
          if (pwd) return pwd;
        }
      }
    }

    // 2. 次之從「系統設定」工作表讀取 ADMIN_PASSWORD
    const cfgSheet = ss.getSheetByName('系統設定');
    if (cfgSheet && cfgSheet.getLastRow() >= 2) {
      const cRows = cfgSheet.getDataRange().getDisplayValues();
      for (let r = 1; r < cRows.length; r++) {
        const k = String(cRows[r][0] || '').trim();
        if (k === 'ADMIN_PASSWORD') {
          const val = String(cRows[r][1] || '').trim();
          if (val) return val;
        }
      }
    }
  } catch (e) {
    console.warn('讀取試算表管理者密碼失敗，改用屬性服務：' + e.message);
  }

  // 3. 次之從 ScriptProperties 讀取
  const propPwd = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (propPwd && String(propPwd).trim()) return String(propPwd).trim();

  // 4. 預設管理密碼
  return CONFIG.DEFAULT_PASSWORD;
}

function setAdminPasswordInSpreadsheet_(newPwd) {
  const cleanPwd = String(newPwd || '').trim();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD', cleanPwd);

  try {
    const ss = getSpreadsheet();

    // 1. 同步寫回「管理者名單」
    let adminSheet = ss.getSheetByName('管理者名單');
    if (!adminSheet) {
      adminSheet = ss.insertSheet('管理者名單');
      adminSheet.appendRow(['帳號', '姓名', '密碼', '說明']);
      adminSheet.getRange(1, 1, 1, 4).setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    }
    const adminRows = adminSheet.getDataRange().getDisplayValues();
    let foundAdminRow = -1;
    let pwdCol = 2;
    if (adminRows.length >= 1) {
      const h = adminRows[0];
      for (let c = 0; c < h.length; c++) {
        const colName = String(h[c] || '').trim();
        if (colName === '密碼') pwdCol = c;
      }
      for (let r = 1; r < adminRows.length; r++) {
        if (String(adminRows[r][0] || '').trim().toLowerCase() === 'admin') {
          foundAdminRow = r + 1; // 1-based row index
          break;
        }
      }
    }
    if (foundAdminRow > 0) {
      const cell = adminSheet.getRange(foundAdminRow, pwdCol + 1);
      if (typeof cell.setNumberFormat === 'function') cell.setNumberFormat('@');
      cell.setValue(cleanPwd);
    } else {
      adminSheet.appendRow(['admin', '學務處訓育組', cleanPwd, '系統最高管理權限']);
      const lr = adminSheet.getLastRow();
      const cell = adminSheet.getRange(lr, pwdCol + 1);
      if (typeof cell.setNumberFormat === 'function') cell.setNumberFormat('@');
    }

    // 2. 同步寫回「系統設定」
    let cfgSheet = ss.getSheetByName('系統設定');
    if (cfgSheet) {
      const cRows = cfgSheet.getDataRange().getDisplayValues();
      let foundCfgRow = -1;
      for (let r = 1; r < cRows.length; r++) {
        if (String(cRows[r][0] || '').trim() === 'ADMIN_PASSWORD') {
          foundCfgRow = r + 1;
          break;
        }
      }
      if (foundCfgRow > 0) {
        const cCell = cfgSheet.getRange(foundCfgRow, 2);
        if (typeof cCell.setNumberFormat === 'function') cCell.setNumberFormat('@');
        cCell.setValue(cleanPwd);
      } else {
        cfgSheet.appendRow(['ADMIN_PASSWORD', cleanPwd, '學務處行政管理密碼（管理者可直接於「管理者名單」工作表查看與修改）']);
        const lr = cfgSheet.getLastRow();
        const cCell = cfgSheet.getRange(lr, 2);
        if (typeof cCell.setNumberFormat === 'function') cCell.setNumberFormat('@');
      }
    }
  } catch (e) {
    console.warn('寫入試算表管理者密碼失敗：' + e.message);
  }
}

function verifyAdminSession_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get('ADMIN_SESSION_' + token) === 'ACTIVE';
}

function assertAdminAuth_(token) {
  if (!verifyAdminSession_(token) || (getAdminPassword_() === CONFIG.DEFAULT_PASSWORD)) {
    throw new Error('403 Unauthorized: 未經授權的管理端操作或 Session 已過期，請重新登入管理員帳號！');
  }
}

function loginAdmin(pwd) {
  const cleanInput = String(pwd === undefined || pwd === null ? '' : pwd).trim();
  if (!cleanInput) {
    return { status: 'error', message: '請輸入管理密碼！' };
  }
  const realPwd = getAdminPassword_();
  const isMatch = (cleanInput === realPwd) || (typeof verifyScorePassword_ === 'function' && verifyScorePassword_(cleanInput, 'admin', realPwd, false));
  if (isMatch) {
    const adminToken = Utilities.getUuid();
    CacheService.getScriptCache().put('ADMIN_SESSION_' + adminToken, 'ACTIVE', CONFIG.SESSION_EXPIRE_SEC);
    return {
      status: 'success',
      token: adminToken,
      isDefault: (cleanInput === CONFIG.DEFAULT_PASSWORD || realPwd === CONFIG.DEFAULT_PASSWORD)
    };
  }
  return { status: 'error', message: '管理密碼錯誤！' };
}

function changeAdminPassword(adminToken, oldPwd, newPwd) {
  if (!verifyAdminSession_(adminToken)) throw new Error('403 Unauthorized');
  const realPwd = getAdminPassword_();

  const isOldMatch = (String(oldPwd).trim() === realPwd) || (typeof verifyScorePassword_ === 'function' && verifyScorePassword_(oldPwd, 'admin', realPwd, false));
  if (!isOldMatch) {
    return { status: 'error', message: '舊密碼不正確！' };
  }
  if (!newPwd || String(newPwd).trim().length < 8 || String(newPwd).trim() === CONFIG.DEFAULT_PASSWORD) {
    return { status: 'error', message: '新密碼至少 8 碼，且不得使用預設密碼！' };
  }

  setAdminPasswordInSpreadsheet_(String(newPwd).trim());
  return { status: 'success', message: '管理密碼修改成功，已同步更新至 Google 試算表「管理者名單」與「系統設定」！' };
}

function saveSystemSettings(adminToken, newSettings) {
  assertAdminAuth_(adminToken);
  newSettings = newSettings || {};

  // 網頁與試算表統一名稱驗證：若提供 title 欄位，不可為空白
  let cleanTitle = null;
  if (newSettings.title !== undefined) {
    cleanTitle = String(newSettings.title).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
    if (!cleanTitle) {
      return { status: 'error', message: '系統與試算表統一名稱不可為空白！' };
    }
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('系統設定');
  const data = sheet.getDataRange().getValues();
  let titleUpdated = false;

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    if (key === 'SYSTEM_TITLE' && cleanTitle !== null) {
      sheet.getRange(i + 1, 2).setValue(cleanTitle);
      titleUpdated = true;
    }
    else if (key === 'SELECTION_MODE' && newSettings.mode !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.mode);
    else if (key === 'OPEN_TIME' && newSettings.openTime !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.openTime);
    else if (key === 'CLOSE_TIME' && newSettings.closeTime !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.closeTime);
    else if (key === 'AI_ADVISOR_ENABLED' && newSettings.aiAdvisorEnabled !== undefined) sheet.getRange(i + 1, 2).setValue(String(newSettings.aiAdvisorEnabled));
    else if (key === 'MAX_PER_CLASS_PER_CLUB' && newSettings.maxPerClass !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.maxPerClass);
    else if (key === 'EMAIL_NOTIFICATION_ENABLED' && newSettings.emailNotificationEnabled !== undefined) sheet.getRange(i + 1, 2).setValue(String(newSettings.emailNotificationEnabled));
  }

  if (cleanTitle !== null && !titleUpdated) {
    sheet.appendRow(['SYSTEM_TITLE', cleanTitle, '系統與試算表統一名稱']);
  }

  if (newSettings.geminiApiKey) {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', newSettings.geminiApiKey.trim());
  }

  try { formatSheetLayout_(sheet); } catch (e) {}

  let spreadsheetRenamed = false;
  let spreadsheetName = ss.getName();
  if (cleanTitle !== null && spreadsheetName !== cleanTitle) {
    try {
      ss.rename(cleanTitle);
      spreadsheetName = ss.getName();
      spreadsheetRenamed = true;
    } catch (renameErr) {
      return {
        status: 'error',
        message: '系統設定已寫入，但同步更名 Google 試算表失敗：' + renameErr.message
      };
    }
  }

  const effectiveTitle = cleanTitle !== null ? cleanTitle : getSystemSettings().title;
  return {
    status: 'success',
    title: effectiveTitle,
    spreadsheetName: spreadsheetName,
    spreadsheetRenamed: spreadsheetRenamed,
    message: spreadsheetRenamed
      ? `系統設定已儲存，並同步將 Google 試算表更名為「${spreadsheetName}」！`
      : '系統設定已儲存並即時生效！'
  };
}

// ==================== 學生端 API ====================

// ==================== 後台社團資料管理（直接寫回試算表「社團設定」） ====================
/** 避免試算表公式注入：開頭為 = + - @ 的文字前置單引號 */
function sanitizeCell_(value, maxLen) {
  const s = String(value === undefined || value === null ? '' : value).trim().slice(0, maxLen || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function saveClub(adminToken, club) {
  assertAdminAuth_(adminToken);
  if (!club || typeof club !== 'object') return { status: 'error', message: '社團資料格式錯誤！' };

  const name = String(club.name || '').trim().slice(0, 40);
  const limit = parseInt(club.limit, 10);
  if (!name) return { status: 'error', message: '社團名稱為必填！' };
  // 社團名稱會被學生名單引用，必須與儲存值完全一致，因此直接拒絕可能被當成公式的開頭
  if (/^[=+\-@]/.test(name)) return { status: 'error', message: '社團名稱不可以 = + - @ 開頭！' };
  if (!(limit > 0) || limit > 500) return { status: 'error', message: '人數上限需為 1～500 的整數！' };
  const original = String(club.originalName || '').trim();

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) return { status: 'error', message: '伺服器忙碌中，請稍後再試。' };

    const sheet = getSpreadsheet().getSheetByName('社團設定');
    const data = sheet.getDataRange().getValues();
    let originalRow = -1;
    let nameRow = -1;
    for (let i = 1; i < data.length; i++) {
      const n = String(data[i][0]).trim();
      if (original && n === original) originalRow = i + 1;
      if (n === name) nameRow = i + 1;
    }

    const fields = [
      sanitizeCell_(club.teacher, 40),
      sanitizeCell_(club.location, 60),
      sanitizeCell_(club.desc, 300),
      sanitizeCell_(club.requirement, 120),
      sanitizeCell_(club.category || '綜合興趣', 20)
    ];

    if (original) {
      if (originalRow === -1) return { status: 'error', message: '找不到要修改的原社團，請重新整理後再試。' };
      const current = parseInt(data[originalRow - 1][2], 10) || 0;
      if (name !== original && nameRow !== -1) return { status: 'error', message: '已有同名社團，請改用其他名稱！' };
      if (name !== original && current > 0) {
        return { status: 'error', message: '此社團已有學生錄取，為避免名冊對應錯誤，不可更名！' };
      }
      if (limit < current) {
        return { status: 'error', message: '人數上限不可低於目前已錄取人數（' + current + ' 人）！' };
      }
      sheet.getRange(originalRow, 1, 1, 8).setValues([[name, limit, current].concat(fields)]);
      try { formatSheetLayout_(sheet); } catch (e) {}
      return { status: 'success', message: '社團【' + name + '】已更新並寫入試算表。', clubs: getClubList() };
    }

    if (nameRow !== -1) return { status: 'error', message: '已有同名社團，請改用其他名稱！' };
    sheet.appendRow([name, limit, 0].concat(fields));
    try { formatSheetLayout_(sheet); } catch (e) {}
    return { status: 'success', message: '社團【' + name + '】已新增並寫入試算表。', clubs: getClubList() };
  } catch (err) {
    console.error('saveClub error: ' + err.message);
    return { status: 'error', message: '儲存社團時發生異常，請稍後再試。' };
  } finally {
    lock.releaseLock();
  }
}

function deleteClub(adminToken, clubName) {
  assertAdminAuth_(adminToken);
  const target = String(clubName || '').trim();
  if (!target) return { status: 'error', message: '請指定要刪除的社團！' };

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) return { status: 'error', message: '伺服器忙碌中，請稍後再試。' };

    const sheet = getSpreadsheet().getSheetByName('社團設定');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === target) {
        const current = parseInt(data[i][2], 10) || 0;
        if (current > 0) {
          return { status: 'error', message: '此社團已有 ' + current + ' 位學生錄取，無法刪除！' };
        }
        sheet.deleteRow(i + 1);
        return { status: 'success', message: '社團【' + target + '】已從試算表刪除。', clubs: getClubList() };
      }
    }
    return { status: 'error', message: '找不到該社團，請重新整理後再試。' };
  } catch (err) {
    console.error('deleteClub error: ' + err.message);
    return { status: 'error', message: '刪除社團時發生異常，請稍後再試。' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 管理員一鍵載入／重設 28 所跨校熱門多元社團（寫入試算表「社團設定」）
 */
function seedCanonicalClubs(adminToken, overwrite) {
  assertAdminAuth_(adminToken);
  const ss = getSpreadsheet();
  const res = seedCanonicalClubsToSheet_(ss, !!overwrite);
  PropertiesService.getScriptProperties().setProperty('CANONICAL_CLUBS_V', '28');
  return {
    status: 'success',
    message: `成功載入 28 所跨校熱門多元社團（共 ${res.count || getClubList().length} 個社團），名額已同步至試算表！`,
    clubs: getClubList()
  };
}

/**
 * 公開社團總覽查詢（提供訪客與學生首頁直接預覽本學期 28 所熱門社團）
 */
function getPublicClubCatalog() {
  const clubs = getClubList();
  return {
    status: 'success',
    totalClubs: clubs.length,
    clubs: clubs
  };
}

// ==================== 班級代碼、帳號密碼與 Session 驗證（比照成績查詢系統） ====================

function normalizeClassCode_(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d{3}$/.test(raw)) return raw;
  const zhMatch = raw.match(/([789])\s*年\s*(\d{1,2})\s*班?/);
  if (zhMatch) return zhMatch[1] + String(zhMatch[2]).padStart(2, '0');
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 3 && /^[789]/.test(digits)) return digits;
  return raw;
}

function padSeatNo_(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw;
}

function padBirthMMDD_(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim().replace(/\D/g, '');
  if (!raw) return '';
  return raw.length <= 4 ? raw.padStart(4, '0') : raw.slice(-4);
}

function isClassMatch_(clsA, clsB) {
  const a = normalizeClassCode_(clsA);
  const b = normalizeClassCode_(clsB);
  return !!a && a === b;
}

function constantTimeEqual_(a, b) {
  const strA = String(a === undefined || a === null ? '' : a);
  const strB = String(b === undefined || b === null ? '' : b);
  let diff = strA.length ^ strB.length;
  const len = Math.max(strA.length, strB.length);
  for (let i = 0; i < len; i++) {
    const ca = i < strA.length ? strA.charCodeAt(i) : 0;
    const cb = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function hashScorePassword_(account, password) {
  const saltAccount = String(account === undefined || account === null ? '' : account).trim().toLowerCase();
  const payload = 'dsjh_v1$' + saltAccount + '$' + String(password === undefined || password === null ? '' : password);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload, Utilities.Charset.UTF_8);
  const hex = digest.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  return 'sha256$' + hex;
}

function verifyScorePassword_(inputPwd, account, storedPwd, caseInsensitivePlain) {
  const candidate = String(inputPwd === undefined || inputPwd === null ? '' : inputPwd);
  const stored = String(storedPwd === undefined || storedPwd === null ? '' : storedPwd).trim();
  if (!stored) return false;
  if (stored.indexOf('sha256$') === 0) {
    return constantTimeEqual_(hashScorePassword_(account, candidate), stored);
  }
  if (caseInsensitivePlain) {
    return constantTimeEqual_(candidate.trim().toUpperCase(), stored.toUpperCase());
  }
  return constantTimeEqual_(candidate, stored);
}

function checkLoginRateLimit_(scope, account) {
  const key = 'LOGIN_FAIL_' + scope + '_' + String(account || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  if (!raw) return { allowed: true };
  try {
    const info = JSON.parse(raw);
    if ((info.count || 0) >= CONFIG.LOGIN_MAX_ATTEMPTS) {
      return {
        allowed: false,
        message: `密碼連續錯誤達 ${CONFIG.LOGIN_MAX_ATTEMPTS} 次，帳號暫時鎖定 15 分鐘；若忘記密碼請洽教務處註冊組。`
      };
    }
  } catch (e) {}
  return { allowed: true };
}

function recordLoginFailure_(scope, account) {
  const key = 'LOGIN_FAIL_' + scope + '_' + String(account || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  let count = 0;
  try {
    const raw = cache.get(key);
    if (raw) count = Number(JSON.parse(raw).count) || 0;
  } catch (e) {}
  count += 1;
  cache.put(key, JSON.stringify({ count: count, ts: Date.now() }), CONFIG.LOGIN_LOCK_SECONDS);
  const remaining = Math.max(0, CONFIG.LOGIN_MAX_ATTEMPTS - count);
  return { count: count, remaining: remaining };
}

function clearLoginFailures_(scope, account) {
  const key = 'LOGIN_FAIL_' + scope + '_' + String(account || '').trim().toLowerCase();
  try {
    CacheService.getScriptCache().remove(key);
  } catch (e) {}
}

function verifyStudentSession_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('STU_SESSION_' + String(token).trim());
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function verifyTeacherSession_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('TCH_SESSION_' + String(token).trim());
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getStudentColIndex_(headerRow) {
  const idx = {
    studentId: 0, name: 1, className: 2, seat: 3, idLast4: 4, birthMMDD: 5, password: 6,
    email: 7, pref1: 8, pref2: 9, pref3: 10, assignedClub: 11, selectedTime: 12,
    note: 13, lockedClub: 14, healthNotice: 15
  };
  if (Array.isArray(headerRow)) {
    for (let c = 0; c < headerRow.length; c++) {
      const h = String(headerRow[c] || '').trim();
      if (h === '學號') idx.studentId = c;
      else if (h === '姓名') idx.name = c;
      else if (h === '班級' || h === '負責班級') idx.className = c;
      else if (h === '座號') idx.seat = c;
      else if (h === '身分證後四碼' || h === '身分證字號') idx.idLast4 = c;
      else if (h === '出生月日') idx.birthMMDD = c;
      else if (h === '登入密碼' || h === '密碼') idx.password = c;
      else if (h === '學生Email' || h === 'Email') idx.email = c;
      else if (h === '第一志願') idx.pref1 = c;
      else if (h === '第二志願') idx.pref2 = c;
      else if (h === '第三志願') idx.pref3 = c;
      else if (h === '錄取社團') idx.assignedClub = c;
      else if (h === '選填時間') idx.selectedTime = c;
      else if (h === '分發備註') idx.note = c;
      else if (h === '保障身分鎖定') idx.lockedClub = c;
      else if (h === '健康安全提醒') idx.healthNotice = c;
    }
  }
  return idx;
}

function getStudentSheet_(ss) {
  return ss.getSheetByName('學生名單') || ss.getSheetByName('學生名冊');
}

function buildStudentFallbackPwd_(row, cols) {
  const idPart = String(row[cols.idLast4] || '').trim().slice(-4).toUpperCase();
  const birthPart = padBirthMMDD_(row[cols.birthMMDD]);
  return idPart && birthPart ? (idPart + birthPart) : idPart;
}

function getClassList() {
  const ss = getSpreadsheet();
  const sheet = getStudentSheet_(ss);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const cols = getStudentColIndex_(data[0]);
  const classSet = {};

  for (let i = 1; i < data.length; i++) {
    const cls = normalizeClassCode_(data[i][cols.className]);
    if (cls) classSet[cls] = true;
  }

  return Object.keys(classSet).sort();
}

function verifyAndGetClubs(account, password) {
  const cleanAccount = String(account || '').trim();
  const inputPwd = String(password || '');
  if (!cleanAccount || !inputPwd.trim()) {
    return { status: 'error', message: '請輸入 7 碼學號與登入密碼！' };
  }

  const rateCheck = checkLoginRateLimit_('student', cleanAccount);
  if (!rateCheck.allowed) {
    return { status: 'error', message: rateCheck.message };
  }

  const ss = getSpreadsheet();
  const studentSheet = getStudentSheet_(ss);
  if (!studentSheet) return { status: 'error', message: '尚未建立學生名單工作表！' };
  const sData = studentSheet.getDataRange().getDisplayValues();
  const cols = getStudentColIndex_(sData[0]);

  let matchedRow = null;
  for (let i = 1; i < sData.length; i++) {
    const rowId = String(sData[i][cols.studentId] || '').trim();
    if (rowId && rowId.toLowerCase() === cleanAccount.toLowerCase()) {
      matchedRow = sData[i];
      break;
    }
  }

  if (!matchedRow) {
    const fail = recordLoginFailure_('student', cleanAccount);
    return {
      status: 'error',
      message: fail.remaining > 0
        ? `學號或密碼錯誤，還可嘗試 ${fail.remaining} 次；若忘記密碼請洽教務處註冊組。`
        : '密碼連續錯誤達 5 次，帳號已鎖定 15 分鐘；若忘記密碼請洽教務處註冊組。'
    };
  }

  const storedPwd = String(matchedRow[cols.password] || '').trim();
  const effectivePwd = storedPwd || buildStudentFallbackPwd_(matchedRow, cols);
  if (!verifyScorePassword_(inputPwd, cleanAccount, effectivePwd, true)) {
    const fail = recordLoginFailure_('student', cleanAccount);
    return {
      status: 'error',
      message: fail.remaining > 0
        ? `學號或密碼錯誤（預設為身分證後4碼+出生月日4碼，如 56780509），還可嘗試 ${fail.remaining} 次；若忘記密碼請洽教務處註冊組。`
        : '密碼連續錯誤達 5 次，帳號已鎖定 15 分鐘；若忘記密碼請洽教務處註冊組。'
    };
  }

  clearLoginFailures_('student', cleanAccount);

  const normClass = normalizeClassCode_(matchedRow[cols.className]);
  const student = {
    studentId: cleanAccount,
    className: normClass,
    seat: padSeatNo_(matchedRow[cols.seat]),
    name: String(matchedRow[cols.name] || '').trim(),
    email: String(matchedRow[cols.email] || '').trim(),
    pref1: String(matchedRow[cols.pref1] || '').trim(),
    pref2: String(matchedRow[cols.pref2] || '').trim(),
    pref3: String(matchedRow[cols.pref3] || '').trim(),
    assignedClub: String(matchedRow[cols.assignedClub] || '').trim(),
    selectedTime: String(matchedRow[cols.selectedTime] || '').trim(),
    lockedClub: String(matchedRow[cols.lockedClub] || '').trim(),
    healthNotice: String(matchedRow[cols.healthNotice] || '').trim()
  };

  const studentToken = Utilities.getUuid();
  CacheService.getScriptCache().put('STU_SESSION_' + studentToken, JSON.stringify({
    studentId: cleanAccount,
    className: normClass,
    seat: student.seat,
    name: student.name
  }), 7200);

  const classClubCounts = {};
  for (let i = 1; i < sData.length; i++) {
    if (isClassMatch_(sData[i][cols.className], normClass)) {
      const assigned = String(sData[i][cols.assignedClub] || '').trim();
      if (assigned) {
        classClubCounts[assigned] = (classClubCounts[assigned] || 0) + 1;
      }
    }
  }

  const clubs = getClubList().map(c => ({
    ...c,
    classCount: classClubCounts[c.name] || 0
  }));
  const settings = getSystemSettings();

  return {
    status: 'success',
    token: studentToken,
    student: student,
    clubs: clubs,
    classClubCounts: classClubCounts,
    settings: settings
  };
}

function buildStudentDashboardResponse_(studentId, token) {
  const ss = getSpreadsheet();
  const studentSheet = getStudentSheet_(ss);
  if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };
  const sData = studentSheet.getDataRange().getDisplayValues();
  const cols = getStudentColIndex_(sData[0]);

  let matchedRow = null;
  for (let i = 1; i < sData.length; i++) {
    if (String(sData[i][cols.studentId] || '').trim().toLowerCase() === String(studentId).trim().toLowerCase()) {
      matchedRow = sData[i];
      break;
    }
  }
  if (!matchedRow) return { status: 'error', message: '查無學生資料！' };

  const normClass = normalizeClassCode_(matchedRow[cols.className]);
  const student = {
    studentId: String(matchedRow[cols.studentId] || '').trim(),
    className: normClass,
    seat: padSeatNo_(matchedRow[cols.seat]),
    name: String(matchedRow[cols.name] || '').trim(),
    email: String(matchedRow[cols.email] || '').trim(),
    pref1: String(matchedRow[cols.pref1] || '').trim(),
    pref2: String(matchedRow[cols.pref2] || '').trim(),
    pref3: String(matchedRow[cols.pref3] || '').trim(),
    assignedClub: String(matchedRow[cols.assignedClub] || '').trim(),
    selectedTime: String(matchedRow[cols.selectedTime] || '').trim(),
    lockedClub: String(matchedRow[cols.lockedClub] || '').trim(),
    healthNotice: String(matchedRow[cols.healthNotice] || '').trim()
  };

  const classClubCounts = {};
  for (let i = 1; i < sData.length; i++) {
    if (isClassMatch_(sData[i][cols.className], normClass)) {
      const assigned = String(sData[i][cols.assignedClub] || '').trim();
      if (assigned) classClubCounts[assigned] = (classClubCounts[assigned] || 0) + 1;
    }
  }

  const clubs = getClubList().map(c => ({ ...c, classCount: classClubCounts[c.name] || 0 }));
  return {
    status: 'success',
    token: token,
    student: student,
    clubs: clubs,
    classClubCounts: classClubCounts,
    settings: getSystemSettings()
  };
}

function changeStudentPassword(studentToken, currentPassword, newPassword) {
  return {
    status: 'error',
    message: '本系統學生密碼由教務處註冊組統一管理，不開放線上自行變更；若忘記密碼請洽教務處註冊組。'
  };
}

function getClubList() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('社團設定');
  const data = sheet.getDataRange().getValues();
  const clubs = [];

  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0]).trim();
    if (name) {
      clubs.push({
        name: name,
        limit: parseInt(data[i][1], 10) || 0,
        current: parseInt(data[i][2], 10) || 0,
        teacher: String(data[i][3] || ''),
        location: String(data[i][4] || ''),
        desc: String(data[i][5] || ''),
        requirement: String(data[i][6] || ''),
        category: String(data[i][7] || '綜合興趣')
      });
    }
  }

  return clubs;
}

// ==================== 學生即時選社（含班級人數防抱團、等冪性、Email發送） ====================
function submitSelection(studentToken, selectedClub) {
  const session = verifyStudentSession_(studentToken);
  if (!session) {
    return { status: 'error', message: '登入階段已逾時，請重新以學號與密碼登入！' };
  }

  const settings = getSystemSettings();
  const now = new Date();
  if (settings.openTime && now < new Date(settings.openTime)) {
    return { status: 'error', message: '目前非開放選社時段，尚未開始！' };
  }
  if (settings.closeTime && now > new Date(settings.closeTime)) {
    return { status: 'error', message: '選社時段已截止，無法再進行送出！' };
  }

  const lock = LockService.getScriptLock();
  try {
    const hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
    if (!hasLock) {
      return { status: 'error', message: '伺服器流量較高正在排隊中，請於 3 秒後重試。' };
    }

    const ss = getSpreadsheet();
    const studentSheet = getStudentSheet_(ss);
    const clubSheet = ss.getSheetByName('社團設定');
    if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };

    const sData = studentSheet.getDataRange().getDisplayValues();
    const cols = getStudentColIndex_(sData[0]);
    const cData = clubSheet.getDataRange().getValues();

    let studentRowIndex = -1;
    let studentObj = null;

    // 1. 依已驗證學號查核學生狀態與保障身分
    for (let i = 1; i < sData.length; i++) {
      const rowId = String(sData[i][cols.studentId] || '').trim();
      if (rowId && rowId.toLowerCase() === String(session.studentId).toLowerCase()) {
        studentRowIndex = i + 1;
        studentObj = {
          studentId: rowId,
          className: normalizeClassCode_(sData[i][cols.className]),
          seat: padSeatNo_(sData[i][cols.seat]),
          name: String(sData[i][cols.name] || '').trim(),
          email: String(sData[i][cols.email] || '').trim(),
          assigned: String(sData[i][cols.assignedClub] || '').trim(),
          time: String(sData[i][cols.selectedTime] || '').trim(),
          locked: String(sData[i][cols.lockedClub] || '').trim()
        };

        if (studentObj.assigned === selectedClub) {
          return {
            status: 'success',
            message: '您已成功報名錄取【' + selectedClub + '】（先前已確認）！',
            clubName: selectedClub,
            timestamp: studentObj.time || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
            isDuplicateConfirm: true
          };
        }

        if (studentObj.assigned) {
          return { status: 'error', message: '您先前已成功錄取【' + studentObj.assigned + '】，不得重複選填或更改！' };
        }

        if (studentObj.locked) {
          return { status: 'error', message: '您已被學務處設定為身分保障錄取【' + studentObj.locked + '】，無須再次登記！' };
        }
        break;
      }
    }

    if (studentRowIndex === -1 || !studentObj) {
      return { status: 'error', message: '查無該學生資料！' };
    }

    // 2. 驗證社團與名額
    let clubRowIndex = -1;
    let limit = 0;
    let current = 0;
    let teacher = '';
    let location = '';

    for (let j = 1; j < cData.length; j++) {
      if (String(cData[j][0]).trim() === String(selectedClub).trim()) {
        clubRowIndex = j + 1;
        limit = parseInt(cData[j][1], 10) || 0;
        current = parseInt(cData[j][2], 10) || 0;
        teacher = cData[j][3];
        location = cData[j][4];
        break;
      }
    }

    if (clubRowIndex === -1) {
      return { status: 'error', message: '所選社團不存在！' };
    }

    if (current >= limit) {
      return { status: 'error', message: '抱歉！【' + selectedClub + '】名額剛剛已額滿，請返回選擇其他社團。' };
    }

    // 3. 👥 班級人數上限（防抱團檢核）
    const maxPerClass = settings.maxPerClass || CONFIG.MAX_PER_CLASS_PER_CLUB;
    let classCountInClub = 0;
    for (let i = 1; i < sData.length; i++) {
      if (isClassMatch_(sData[i][cols.className], studentObj.className) &&
          String(sData[i][cols.assignedClub]).trim() === String(selectedClub).trim()) {
        classCountInClub++;
      }
    }

    if (classCountInClub >= maxPerClass) {
      return {
        status: 'error',
        message: `為促進跨班交流，【${selectedClub}】貴班報名人數已達上限（${maxPerClass}人），請選擇其他社團！`
      };
    }

    // 4. 原子寫入試算表
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
    studentSheet.getRange(studentRowIndex, cols.assignedClub + 1).setValue(selectedClub);
    studentSheet.getRange(studentRowIndex, cols.selectedTime + 1).setValue(timestamp);
    studentSheet.getRange(studentRowIndex, cols.note + 1).setValue('即時選填成功');

    clubSheet.getRange(clubRowIndex, 3).setValue(current + 1);

    // 5. 📧 錄取通知信同步發送
    let emailSent = false;
    if (settings.emailNotificationEnabled && studentObj.email) {
      emailSent = sendAdmissionEmail_(studentObj, {
        name: selectedClub,
        teacher: teacher,
        location: location
      }, timestamp);
    }

    return {
      status: 'success',
      message: '恭喜！您已成功報名錄取【' + selectedClub + '】！' + (emailSent ? '（錄取通知函已寄至您的信箱）' : ''),
      clubName: selectedClub,
      timestamp: timestamp,
      emailSent: emailSent
    };

  } catch (err) {
    console.error('submitSelection error: ' + err.message);
    return { status: 'error', message: '系統處理發生異常，請重試或聯繫學務處。' };
  } finally {
    lock.releaseLock();
  }
}

// ==================== 多志願序模式提交 ====================
function submitPreferences(studentToken, pref1, pref2, pref3) {
  const session = verifyStudentSession_(studentToken);
  if (!session) {
    return { status: 'error', message: '登入階段已逾時，請重新以學號與密碼登入！' };
  }

  const settings = getSystemSettings();
  const now = new Date();
  if (settings.openTime && now < new Date(settings.openTime)) return { status: 'error', message: '選填尚未開放！' };
  if (settings.closeTime && now > new Date(settings.closeTime)) return { status: 'error', message: '選填時間已截止！' };

  if (!pref1) return { status: 'error', message: '第一志願為必填項目！' };
  if (pref1 === pref2 || (pref2 && pref2 === pref3) || (pref3 && pref1 === pref3)) {
    return { status: 'error', message: '志願社團不可重複選擇！' };
  }

  const ss = getSpreadsheet();
  const sheet = getStudentSheet_(ss);
  if (!sheet) return { status: 'error', message: '查無學生名單工作表！' };
  const data = sheet.getDataRange().getDisplayValues();
  const cols = getStudentColIndex_(data[0]);

  let studentRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][cols.studentId] || '').trim();
    if (rowId && rowId.toLowerCase() === String(session.studentId).toLowerCase()) {
      studentRowIndex = i + 1;
      break;
    }
  }

  if (studentRowIndex === -1) return { status: 'error', message: '查無此學生資料！' };

  const timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  sheet.getRange(studentRowIndex, cols.pref1 + 1).setValue(pref1);
  sheet.getRange(studentRowIndex, cols.pref2 + 1).setValue(pref2 || '');
  sheet.getRange(studentRowIndex, cols.pref3 + 1).setValue(pref3 || '');
  sheet.getRange(studentRowIndex, cols.selectedTime + 1).setValue(timestamp);
  sheet.getRange(studentRowIndex, cols.note + 1).setValue('志願已登記，待分發');

  return {
    status: 'success',
    message: '志願序儲存成功！學務處將於選填截止後進行公平適性分發。',
    preferences: [pref1, pref2, pref3],
    timestamp: timestamp
  };
}

// ==================== 學生開放期間重新改選（安全釋出原社團名額） ====================
function cancelSelection(studentToken) {
  const session = verifyStudentSession_(studentToken);
  if (!session) {
    return { status: 'error', message: '登入階段已逾時，請重新以學號與密碼登入！' };
  }

  const settings = getSystemSettings();
  const now = new Date();
  if (settings.openTime && now < new Date(settings.openTime)) {
    return { status: 'error', message: '目前非開放選社時段！' };
  }
  if (settings.closeTime && now > new Date(settings.closeTime)) {
    return { status: 'error', message: '選社時段已截止，無法再自行改選！' };
  }

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      return { status: 'error', message: '伺服器忙碌中，請稍後再試。' };
    }

    const ss = getSpreadsheet();
    const studentSheet = getStudentSheet_(ss);
    const clubSheet = ss.getSheetByName('社團設定');
    if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };
    const sData = studentSheet.getDataRange().getDisplayValues();
    const cols = getStudentColIndex_(sData[0]);
    const cData = clubSheet.getDataRange().getValues();

    let studentRowIndex = -1;
    let oldClub = '';
    let lockedClub = '';

    for (let i = 1; i < sData.length; i++) {
      const rowId = String(sData[i][cols.studentId] || '').trim();
      if (rowId && rowId.toLowerCase() === String(session.studentId).toLowerCase()) {
        studentRowIndex = i + 1;
        oldClub = String(sData[i][cols.assignedClub] || '').trim();
        lockedClub = String(sData[i][cols.lockedClub] || '').trim();
        break;
      }
    }

    if (studentRowIndex === -1) return { status: 'error', message: '查無此學生資料！' };
    if (lockedClub) return { status: 'error', message: '您為專案保障錄取身分，無法自行退選！' };

    if (oldClub) {
      for (let j = 1; j < cData.length; j++) {
        if (String(cData[j][0]).trim() === oldClub) {
          const cur = parseInt(cData[j][2], 10) || 0;
          clubSheet.getRange(j + 1, 3).setValue(Math.max(0, cur - 1));
          break;
        }
      }
      studentSheet.getRange(studentRowIndex, cols.assignedClub + 1).setValue('');
      studentSheet.getRange(studentRowIndex, cols.note + 1).setValue('開放期間重新改選');
    }

    return buildStudentDashboardResponse_(session.studentId, studentToken);
  } catch (err) {
    return { status: 'error', message: '取消選填時發生異常：' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// ==================== Gemini 1.5 Flash 智慧適性選社顧問 ====================

function scrubPII_(text) {
  return String(text || '')
    .slice(0, 300)
    .replace(/[<>{}\\]/g, '')
    .replace(/[A-Z][12]\d{8}/gi, '[身分證號已遮蔽]')
    .replace(/09\d{2}-?\d{3}-?\d{3}|0\d{1,2}-?\d{6,8}/g, '[電話已遮蔽]')
    .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[信箱已遮蔽]');
}

function aiConsultantRecommend(studentInput, studentGrade) {
  const settings = getSystemSettings();
  if (!settings.aiAdvisorEnabled) {
    return { status: 'error', message: '目前 AI 選社顧問功能暫未開啟。' };
  }

  const clubs = getClubList();
  if (!clubs || clubs.length === 0) {
    return { status: 'error', message: '目前尚無社團資料可供比對。' };
  }

  const sanitizedInput = scrubPII_(studentInput);
  const gradeLevel = (studentGrade && /^[789七八九]/.test(String(studentGrade))) 
    ? String(studentGrade).slice(0, 1) + '年級' 
    : '國中生';

  const validClubNames = new Set(clubs.map(c => c.name));
  const clubSummaries = clubs.map((c, idx) => 
    `${idx + 1}. 【${c.name}】(${c.category}) 簡介:${c.desc}，要求:${c.requirement}，名額餘裕:${Math.max(0, c.limit - c.current)}人`
  ).join('\n');

  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return ruleBasedRecommendFallback(sanitizedInput, clubs);
  }

  const systemInstruction = `你是一位專業且熱忱的國中生涯發展與適性選社輔導專家。
請依據學生的年級與口語興趣，從學校開放的社團清單中挑選出最契合的 1 到 3 個社團。
嚴格規範：
1. 推薦的社團名稱必須 100% 存在於提供的清單中，嚴禁捏造社團名稱。
2. 理由需結合 108 課綱核心素養（自主行動、溝通互動或社會參與）具體說明。`;

  const userContent = `學生年級：【${gradeLevel}】\n學生自述興趣：\n"""\n${sanitizedInput}\n"""\n\n學校開放社團大綱：\n${clubSummaries}`;

  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ parts: [{ text: userContent }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          recommendations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                clubName: { type: "STRING" },
                matchScore: { type: "INTEGER" },
                reason: { type: "STRING" }
              },
              required: ["clubName", "matchScore", "reason"]
            }
          },
          encouragement: { type: "STRING" }
        },
        required: ["recommendations", "encouragement"]
      }
    }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.warn('Gemini API 異常，切換至備援規則引擎');
      return ruleBasedRecommendFallback(sanitizedInput, clubs);
    }

    const json = JSON.parse(response.getContentText());
    const candidate = json.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY' || !candidate.content?.parts?.[0]?.text) {
      return ruleBasedRecommendFallback(sanitizedInput, clubs);
    }

    let cleanText = candidate.content.parts[0].text.trim().replace(/^```json\s*|```$/gi, '');
    const result = JSON.parse(cleanText);

    // 🛡️ 防幻覺落地校驗：過濾掉不在學校名單的假社團
    result.recommendations = (result.recommendations || []).filter(r => validClubNames.has(r.clubName));
    if (result.recommendations.length === 0) {
      return ruleBasedRecommendFallback(sanitizedInput, clubs);
    }

    return { status: 'success', data: result, source: 'gemini' };

  } catch (err) {
    console.error('aiConsultantRecommend error: ' + err.message);
    return ruleBasedRecommendFallback(sanitizedInput, clubs);
  }
}

function ruleBasedRecommendFallback(input, clubs) {
  const text = input.toLowerCase();
  const scoredClubs = clubs.map(club => {
    let score = 55;
    const cName = club.name.toLowerCase();
    const cDesc = club.desc.toLowerCase();
    const cCat = (club.category || '').toLowerCase();

    if (text.includes('程式') || text.includes('電腦') || text.includes('ai') || text.includes('機器人') || text.includes('創客') || text.includes('科技')) {
      if (cName.includes('機器人') || cName.includes('創客') || cDesc.includes('程式') || cCat.includes('創客')) score += 40;
    }
    if (text.includes('運動') || text.includes('球') || text.includes('籃球') || text.includes('跑步') || text.includes('體能') || text.includes('活潑')) {
      if (cName.includes('球') || cDesc.includes('體能') || cCat.includes('體育')) score += 40;
    }
    if (text.includes('畫') || text.includes('動漫') || text.includes('設計') || text.includes('插畫') || text.includes('美術') || text.includes('二次元')) {
      if (cName.includes('繪畫') || cName.includes('動漫') || cDesc.includes('著色') || cCat.includes('藝術')) score += 40;
    }
    if (text.includes('音樂') || text.includes('唱歌') || text.includes('吉他') || text.includes('琴') || text.includes('樂器') || text.includes('彈唱')) {
      if (cName.includes('吉他') || cName.includes('烏克麗麗') || cDesc.includes('彈唱') || cCat.includes('音樂')) score += 40;
    }
    if (text.includes('思考') || text.includes('遊戲') || text.includes('桌遊') || text.includes('推理') || text.includes('解謎') || text.includes('安靜')) {
      if (cName.includes('桌遊') || cName.includes('推理') || cDesc.includes('策略') || cCat.includes('邏輯')) score += 40;
    }
    if (text.includes('科學') || text.includes('實驗') || text.includes('好奇') || text.includes('化學') || text.includes('自然')) {
      if (cName.includes('科學') || cDesc.includes('實驗') || cCat.includes('自然')) score += 40;
    }
    if (text.includes('採訪') || text.includes('攝影') || text.includes('拍照') || text.includes('影片') || text.includes('新聞') || text.includes('表達')) {
      if (cName.includes('新聞') || cName.includes('攝影') || cDesc.includes('採訪')) score += 40;
    }

    return {
      clubName: club.name,
      matchScore: score,
      reason: `此社團著重於${club.desc.slice(0, 32)}...，能充分發揮你在${club.category}領域的多元潛能！`
    };
  });

  scoredClubs.sort((a, b) => b.matchScore - a.matchScore);
  const topRecommendations = scoredClubs.slice(0, 3).map((item, idx) => ({
    ...item,
    matchScore: Math.max(70, Math.min(98, item.matchScore - idx * 5))
  }));

  return {
    status: 'success',
    data: {
      recommendations: topRecommendations,
      encouragement: '國中階段是探索多元智能與培養終身興趣的黃金時期！勇敢嘗試不同領域，每一堂社團課都會成為你珍貴的成長歷程。'
    },
    source: 'rule-fallback'
  };
}

// ==================== 📧 錄取通知信寄送核心 (HTML Email) ====================

function sendAdmissionEmail_(student, club, timestamp) {
  if (!student.email || !student.email.includes('@')) return false;

  const systemTitle = (getSystemSettings().title || CONFIG.DEFAULT_TITLE);
  const subject = `【${systemTitle}】社團選社錄取通知函 - ${student.name} 同學`;
  const serialNo = `DX-${Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd')}-${student.className}${student.seat}`;

  const htmlBody = `
  <div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 24px; text-align: center; color: white;">
      <h2 style="margin: 0; font-size: 20px; font-weight: bold;">桃園市立大溪國民中學</h2>
      <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.9;">${systemTitle} — 錄取結果通知書</p>
    </div>
    
    <div style="padding: 24px; background: #ffffff;">
      <p style="font-size: 15px; color: #334155;">親愛的 <strong>${student.name}</strong> 同學及家長您好：</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        恭喜您已順利完成本學期社團選社程序！系統已正式為您保留開課席次，相關資訊如下：
      </p>

      <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b; width: 90px;">錄取社團：</td>
            <td style="padding: 6px 0; color: #1e3a8a; font-size: 18px; font-weight: bold;">${club.name}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">學生班級：</td>
            <td style="padding: 6px 0; color: #334155;">${student.className} 班 ${student.seat} 號</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">指導師資：</td>
            <td style="padding: 6px 0; color: #334155;">${club.teacher || '校內專業師資'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">活動地點：</td>
            <td style="padding: 6px 0; color: #334155;">${club.location || '依學務處公告為準'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">選填時間：</td>
            <td style="padding: 6px 0; color: #334155;">${timestamp}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">驗證序號：</td>
            <td style="padding: 6px 0; color: #0284c7; font-family: monospace; font-weight: bold;">${serialNo}</td>
          </tr>
        </table>
      </div>

      <div style="background: #fffbeb; border: 1px dashed #f59e0b; padding: 12px; border-radius: 8px; font-size: 13px; color: #92400e; line-height: 1.5;">
        📌 <strong>重要注意事項</strong>：<br>
        1. 請依行事曆社團活動時間準時前往各活動教室，無故缺席將依校規曠課論處。<br>
        2. 若有先備用具或材料費要求，請於第一堂課依指導教師指示配合辦理。<br>
        3. 如有任何適性輔導或疑義，請洽學務處訓育組（分機 211）。
      </div>
    </div>

    <div style="background: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
      大溪國中學務處訓育組 敬啟 ｜ 本郵件為系統自動發送，請勿直接回覆
    </div>
  </div>
  `;

  try {
    MailApp.sendEmail({
      to: student.email,
      subject: subject,
      htmlBody: htmlBody
    });
    return true;
  } catch (e) {
    console.warn(`發送郵件給 ${student.email} 失敗: ${e.message}`);
    return false;
  }
}

// ==================== 教師後台管理與 AI 智慧行政 API ====================

function getAdminDashboardData(adminToken) {
  assertAdminAuth_(adminToken);
  const ss = getSpreadsheet();
  const studentSheet = getStudentSheet_(ss);
  if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };
  const sData = studentSheet.getDataRange().getValues();
  const cols = getStudentColIndex_(sData[0]);

  let totalStudents = 0;
  let enrolledCount = 0;
  let unassignedCount = 0;
  let preferencesFilledCount = 0;
  const unassignedStudents = [];

  for (let i = 1; i < sData.length; i++) {
    const cls = sData[i][cols.className];
    if (cls) {
      totalStudents++;
      const assigned = sData[i][cols.assignedClub];
      const locked = sData[i][cols.lockedClub];
      if (assigned || locked) {
        enrolledCount++;
      } else {
        unassignedCount++;
        unassignedStudents.push({
          className: String(sData[i][cols.className] || '').trim(),
          seat: String(sData[i][cols.seat] || '').trim(),
          name: String(sData[i][cols.name] || '').trim(),
          pref1: String(sData[i][cols.pref1] || '').trim()
        });
      }

      if (sData[i][cols.pref1]) preferencesFilledCount++;
    }
  }

  const clubs = getClubList();
  const settings = getSystemSettings();
  settings.spreadsheetUrl = ss.getUrl(); // 🛡️ 僅在管理者驗證後回傳
  settings.spreadsheetName = ss.getName(); // 供後台檢查並統一試算表與首頁名稱

  const teacherSheet = ss.getSheetByName('導師名單');
  const teacherCount = teacherSheet ? Math.max(0, teacherSheet.getDataRange().getValues().length - 1) : 0;

  return {
    status: 'success',
    stats: {
      totalStudents: totalStudents,
      enrolledCount: enrolledCount,
      unassignedCount: unassignedCount,
      preferencesFilledCount: preferencesFilledCount,
      teacherCount: teacherCount,
      enrollmentRate: totalStudents > 0 ? Math.round((enrolledCount / totalStudents) * 100) : 0
    },
    unassignedStudents: unassignedStudents,
    clubs: clubs,
    settings: settings
  };
}

/**
 * ⚡ 智慧行政 1：多志願公平適性分發（2D 陣列批次寫入、修復重複清零 Bug、班級防抱團、抽籤序）
 */
function runAiSmartAllocation(adminToken, previewToken) {
  assertAdminAuth_(adminToken);

  const lock = LockService.getScriptLock();
  try {
    const hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
    if (!hasLock) return { status: 'error', message: '伺服器忙碌中，分發作業請稍候再試。' };

    const ss = getSpreadsheet();
    const studentSheet = getStudentSheet_(ss);
    const clubSheet = ss.getSheetByName('社團設定');
    if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };

    const sData = studentSheet.getDataRange().getValues();
    const cols = getStudentColIndex_(sData[0]);
    const cData = clubSheet.getDataRange().getValues();
    const settings = getSystemSettings();
    const maxPerClass = settings.maxPerClass || CONFIG.MAX_PER_CLASS_PER_CLUB;
    const snapshot = JSON.stringify([sData, cData, maxPerClass]);
    const cache = CacheService.getScriptCache();
    if (previewToken) {
      const key = 'ALLOCATION_' + previewToken;
      const chunkCount = Number(cache.get(key));
      let serialized = '';
      for (let i = 0; i < chunkCount; i++) serialized += cache.get(key + '_' + i) || '';
      let plan;
      try { plan = JSON.parse(serialized); } catch (e) {}
      if (!plan || plan.adminToken !== adminToken || plan.snapshot !== snapshot) {
        return { status: 'error', message: '預覽已過期、名冊或設定已有變動，請重新預覽並確認。' };
      }
      cache.put(key, '0', 1);
      studentSheet.getRange(1, 1, plan.sData.length, plan.sData[0].length).setValues(plan.sData);
      clubSheet.getRange(1, 1, plan.cData.length, plan.cData[0].length).setValues(plan.cData);
      try { formatSheetLayout_(studentSheet); formatSheetLayout_(clubSheet); } catch (e) {}
      return { status: 'success', report: plan.report };
    }

    // 1. 初始化社團容量與各班人數統計
    const clubMap = {};
    for (let j = 1; j < cData.length; j++) {
      const name = String(cData[j][0]).trim();
      if (!name) continue;
      clubMap[name] = {
        limit: parseInt(cData[j][1], 10) || 0,
        assigned: [],
        classCounts: {}, // 統計該社團各班已有的人數
        rowIdx: j
      };
    }

    // 2. 🛡️ 先將「既有已錄取或保障」學生納入佔位，絕不覆蓋清零！
    const pendingStudents = [];
    for (let i = 1; i < sData.length; i++) {
      const cls = normalizeClassCode_(sData[i][cols.className]);
      const currentAssigned = String(sData[i][cols.assignedClub] || '').trim();
      const lockedClub = String(sData[i][cols.lockedClub] || '').trim();

      const studentObj = {
        rowIdx: i,
        className: cls,
        seat: padSeatNo_(sData[i][cols.seat]),
        name: String(sData[i][cols.name]).trim(),
        email: String(sData[i][cols.email] || '').trim(),
        prefs: [sData[i][cols.pref1], sData[i][cols.pref2], sData[i][cols.pref3]].map(p => String(p || '').trim()),
        assigned: currentAssigned,
        note: String(sData[i][cols.note] || '').trim(),
        lotteryNo: null
      };

      // 若有保障鎖定，優先確保
      if (lockedClub && clubMap[lockedClub]) {
        studentObj.assigned = lockedClub;
        studentObj.note = '身分優先保障錄取';
        clubMap[lockedClub].assigned.push(studentObj);
        clubMap[lockedClub].classCounts[cls] = (clubMap[lockedClub].classCounts[cls] || 0) + 1;
        sData[i][cols.assignedClub] = lockedClub;
        sData[i][cols.note] = studentObj.note;
      } else if (currentAssigned && clubMap[currentAssigned]) {
        // 原本已錄取者保留
        clubMap[currentAssigned].assigned.push(studentObj);
        clubMap[currentAssigned].classCounts[cls] = (clubMap[currentAssigned].classCounts[cls] || 0) + 1;
      } else {
        pendingStudents.push(studentObj);
      }
    }

    // 3. 標準 Fisher-Yates 洗牌以確保完全機會公平
    for (let i = pendingStudents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pendingStudents[i], pendingStudents[j]] = [pendingStudents[j], pendingStudents[i]];
    }
    pendingStudents.forEach((student, index) => { student.lotteryNo = index + 1; });

    // 4. 多志願序多輪分發（含各班人數上限過濾）
    const prefCounts = [0, 0, 0];
    for (let round = 0; round < 3; round++) {
      pendingStudents.forEach(s => {
        if (!s.assigned) {
          const desiredClub = s.prefs[round];
          if (desiredClub && clubMap[desiredClub]) {
            const cInfo = clubMap[desiredClub];
            const currentClassCount = cInfo.classCounts[s.className] || 0;

            // 雙條件檢查：名額未滿 且 該班未達上限
            if (cInfo.assigned.length < cInfo.limit && currentClassCount < maxPerClass) {
              cInfo.assigned.push(s);
              cInfo.classCounts[s.className] = currentClassCount + 1;
              s.assigned = desiredClub;
              s.note = `第${round + 1}志願錄取 (抽籤序:${s.lotteryNo})`;
              prefCounts[round]++;
            }
          }
        }
      });
    }

    // 5. 落選兜底行政分流
    let randomCount = 0;
    const availableClubs = Object.keys(clubMap).filter(k => clubMap[k].assigned.length < clubMap[k].limit);
    pendingStudents.forEach(s => {
      if (!s.assigned) {
        availableClubs.sort((a, b) => (clubMap[b].limit - clubMap[b].assigned.length) - (clubMap[a].limit - clubMap[a].assigned.length));
        let allocated = false;
        for (let idx = 0; idx < availableClubs.length; idx++) {
          const target = availableClubs[idx];
          const cInfo = clubMap[target];
          const curClassCount = cInfo.classCounts[s.className] || 0;
          if (cInfo.assigned.length < cInfo.limit && curClassCount < maxPerClass) {
            cInfo.assigned.push(s);
            cInfo.classCounts[s.className] = curClassCount + 1;
            s.assigned = target;
            s.note = `行政適性分流 (抽籤序:${s.lotteryNo})`;
            randomCount++;
            allocated = true;
            if (cInfo.assigned.length >= cInfo.limit) availableClubs.splice(idx, 1);
            break;
          }
        }
        if (!allocated) {
          s.note = `分發未錄取（容量或班級上限限制，待人工輔導；抽籤序:${s.lotteryNo}）`;
        }
      }
    });

    // 6. ⚡ 效能關鍵：批次寫回記憶體陣列（只呼叫 2 次 setValues，徹底排除超時）
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
    pendingStudents.forEach(s => {
      sData[s.rowIdx][cols.assignedClub] = s.assigned || '';
      sData[s.rowIdx][cols.selectedTime] = s.assigned ? timestamp : '';
      sData[s.rowIdx][cols.note] = s.note || '';
    });

    Object.keys(clubMap).forEach(k => {
      const c = clubMap[k];
      cData[c.rowIdx][2] = c.assigned.length; // 精準更新社團已錄取人數
    });

    const totalProcessed = pendingStudents.length;
    const satisfactionRate = totalProcessed > 0
      ? Math.round(((prefCounts[0] + prefCounts[1] + prefCounts[2]) / totalProcessed) * 100)
      : 0;

    const report = {
        totalProcessed: totalProcessed,
        pref1Count: prefCounts[0],
        pref2Count: prefCounts[1],
        pref3Count: prefCounts[2],
        randomAssignedCount: randomCount,
        unassignedCount: pendingStudents.filter(s => !s.assigned).length,
        satisfactionRate: satisfactionRate
      };
    const token = Utilities.getUuid();
    const key = 'ALLOCATION_' + token;
    const serialized = JSON.stringify({ adminToken, snapshot, sData, cData, report });
    const chunks = Math.ceil(serialized.length / 20000);
    for (let i = 0; i < chunks; i++) cache.put(key + '_' + i, serialized.slice(i * 20000, (i + 1) * 20000), 600);
    cache.put(key, String(chunks), 600);
    return {
      status: 'preview', previewToken: token, report,
      review: pendingStudents.map(s => ({ className: s.className, seat: s.seat, lotteryNo: s.lotteryNo, assigned: s.assigned, note: s.note }))
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 📧 智慧行政：分發完成後一鍵批次寄送錄取通知信
 */
function batchSendAllocationEmails(adminToken) {
  assertAdminAuth_(adminToken);
  const ss = getSpreadsheet();
  const studentSheet = getStudentSheet_(ss);
  const clubSheet = ss.getSheetByName('社團設定');
  if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };

  const sData = studentSheet.getDataRange().getValues();
  const cols = getStudentColIndex_(sData[0]);
  const cData = clubSheet.getDataRange().getValues();

  const clubInfoMap = {};
  for (let j = 1; j < cData.length; j++) {
    clubInfoMap[String(cData[j][0]).trim()] = {
      name: cData[j][0],
      teacher: cData[j][3],
      location: cData[j][4]
    };
  }

  let sentCount = 0;
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  for (let i = 1; i < sData.length; i++) {
    const email = String(sData[i][cols.email] || '').trim();
    const assigned = String(sData[i][cols.assignedClub] || '').trim();

    if (email && email.includes('@') && assigned && clubInfoMap[assigned]) {
      const student = {
        className: sData[i][cols.className],
        seat: sData[i][cols.seat],
        name: sData[i][cols.name],
        email: email
      };
      const ok = sendAdmissionEmail_(student, clubInfoMap[assigned], sData[i][cols.selectedTime] || timestamp);
      if (ok) sentCount++;
    }
  }

  return {
    status: 'success',
    sentCount: sentCount,
    message: `已成功將錄取通知函寄送至 ${sentCount} 位學生的 Email 信箱！`
  };
}

/**
 * 📑 智慧行政 2：社團點名簽到單（保留 GID，帶入健康警示標記與校園分機）
 */
function exportAttendanceSheets(adminToken) {
  assertAdminAuth_(adminToken);
  const ss = getSpreadsheet();
  const studentSheet = getStudentSheet_(ss);
  const clubSheet = ss.getSheetByName('社團設定');
  if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };

  const sData = studentSheet.getDataRange().getValues();
  const cols = getStudentColIndex_(sData[0]);
  const cData = clubSheet.getDataRange().getValues();

  const clubStudents = {};
  for (let j = 1; j < cData.length; j++) {
    const clubName = String(cData[j][0]).trim();
    if (clubName) {
      clubStudents[clubName] = {
        teacher: cData[j][3],
        location: cData[j][4],
        list: []
      };
    }
  }

  for (let i = 1; i < sData.length; i++) {
    const assigned = String(sData[i][cols.assignedClub] || '').trim();
    if (assigned && clubStudents[assigned]) {
      clubStudents[assigned].list.push({
        className: sData[i][cols.className],
        seat: sData[i][cols.seat],
        name: sData[i][cols.name],
        health: sData[i][cols.healthNotice] || ''
      });
    }
  }

  // 🛡️ 修復：使用 clear() 保留工作表實體與 GID，避免外部參照與書籤失效
  let attSheet = ss.getSheetByName('社團點名簽到冊');
  if (!attSheet) {
    attSheet = ss.insertSheet('社團點名簽到冊');
  } else {
    attSheet.clear();
  }

  const rows = [];
  rows.push(['桃園市立大溪國民中學 社團活動學生點名簽到表（學務處備查聯）', '', '', '', '', '', '', '', '', '', '']);
  rows.push([
    '產表日期：' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy年MM月dd日'),
    '', '', '', '', '', '',
    '【緊急通報分機】學務處訓育組:211、健康中心:215',
    '', '', ''
  ]);
  rows.push(['社團名稱', '指導教師', '活動地點', '班級', '座號', '姓名', '健康與安全提醒', '第1週簽到', '第2週簽到', '第3週簽到', '第4週簽到']);

  Object.keys(clubStudents).forEach(name => {
    const c = clubStudents[name];
    if (c.list.length === 0) {
      rows.push([name, c.teacher, c.location, '（暫無錄取學生）', '', '', '', '', '', '', '']);
    } else {
      c.list.sort((a, b) => (a.className + a.seat).localeCompare(b.className + b.seat));
      c.list.forEach(st => {
        rows.push([name, c.teacher, c.location, st.className, st.seat, st.name, st.health, '', '', '', '']);
      });
    }
  });

  attSheet.getRange(1, 1, rows.length, 11).setValues(rows);
  attSheet.getRange(1, 1, 1, 11).merge().setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#e8f0fe');
  attSheet.getRange(2, 1, 1, 7).merge();
  attSheet.getRange(2, 8, 1, 4).merge().setHorizontalAlignment('right');
  attSheet.getRange(3, 1, 1, 11).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  try { formatSheetLayout_(attSheet); } catch (e) {}

  return {
    status: 'success',
    sheetUrl: ss.getUrl() + '#gid=' + attSheet.getSheetId(),
    message: '各社團點名簽到表（含健康安全警示標記）已成功產出於【社團點名簽到冊】分頁！'
  };
}

/**
 * 📄 智慧行政 3：社團成果手冊與開課報告 (Google Docs)
 */
function generateClubDocManual(adminToken) {
  assertAdminAuth_(adminToken);
  const ss = getSpreadsheet();
  const clubs = getClubList();

  const systemTitle = (getSystemSettings().title || CONFIG.DEFAULT_TITLE);
  const doc = DocumentApp.create(systemTitle + '_社團成果手冊與開課報告書');
  const body = doc.getBody();

  body.appendParagraph('桃園市立大溪國民中學').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendParagraph('AI 智慧社團選社手冊與行政成果報告書').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`製表時間：${Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')} ｜ 系統版本：特優旗艦版`)
    .setItalic(true);

  body.appendHorizontalRule();
  body.appendParagraph('一、社團課程特色與核心素養架構').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  clubs.forEach((c, idx) => {
    body.appendParagraph(`${idx + 1}. 【${c.name}】（領域：${c.category}）`).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(`• 指導教師：${c.teacher || '校內專業師資'} ｜ 上課教室：${c.location || '專科教室'}`);
    body.appendParagraph(`• 開課人數上限：${c.limit} 人 ｜ 目前已報名：${c.current} 人`);
    body.appendParagraph(`• 核心素養目標：${c.desc}`);
    if (c.requirement) body.appendParagraph(`• 先備要求或注意事項：${c.requirement}`).setItalic(true);
    body.appendParagraph('');
  });

  body.appendHorizontalRule();
  body.appendParagraph('二、智慧行政減量與科技協作成效').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('本系統提供 Gemini 興趣推薦（無法連線時使用規則配對），推薦僅供探索參考。多志願分發採抽籤順序、志願輪次、容量與班級上限規則，須由承辦人預覽確認後套用。前三志願滿足率依本次分發實測，行政工時改善尚待正式量測。');

  doc.saveAndClose();

  return {
    status: 'success',
    docUrl: doc.getUrl(),
    message: '全校社團手冊與行政成果報告書已成功建立於 Google Docs！'
  };
}

/**
 * 👨‍🏫 導師登入（比照成績查詢系統：教師帳號 + 密碼，首次登入強制修改密碼）
 */
function loginTeacher(account, password) {
  const cleanAccount = String(account || '').trim().toLowerCase();
  const inputPwd = String(password || '');
  if (!cleanAccount || !inputPwd.trim()) {
    return { status: 'error', message: '請輸入教師帳號與密碼！' };
  }

  const rateCheck = checkLoginRateLimit_('teacher', cleanAccount);
  if (!rateCheck.allowed) {
    return { status: 'error', message: rateCheck.message };
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('導師名單');
  if (!sheet) {
    return { status: 'error', message: '尚未建立「導師名單」工作表，請管理員先從成績系統同步名單！' };
  }

  const rows = sheet.getDataRange().getDisplayValues();
  let matchedRow = null;
  for (let i = 1; i < rows.length; i++) {
    const rowAcc = String(rows[i][0] || '').trim().toLowerCase();
    if (rowAcc && rowAcc === cleanAccount) {
      matchedRow = rows[i];
      break;
    }
  }

  if (!matchedRow) {
    const fail = recordLoginFailure_('teacher', cleanAccount);
    return {
      status: 'error',
      message: fail.remaining > 0
        ? `教師帳號或密碼錯誤，還可嘗試 ${fail.remaining} 次。`
        : '密碼連續錯誤達 5 次，帳號已鎖定 15 分鐘。'
    };
  }

  const storedPwd = String(matchedRow[3] || '').trim();
  if (!verifyScorePassword_(inputPwd, cleanAccount, storedPwd, false)) {
    const fail = recordLoginFailure_('teacher', cleanAccount);
    return {
      status: 'error',
      message: fail.remaining > 0
        ? `教師帳號或密碼錯誤，還可嘗試 ${fail.remaining} 次。`
        : '密碼連續錯誤達 5 次，帳號已鎖定 15 分鐘。'
    };
  }

  clearLoginFailures_('teacher', cleanAccount);

  const teacherName = String(matchedRow[1] || '').trim();
  const rawAssignedClass = String(matchedRow[2] || '').trim();
  const assignedClass = normalizeClassCode_(rawAssignedClass);
  const firstLoginFlag = String(matchedRow[4] || '').trim().toUpperCase();
  const mustChangePassword = firstLoginFlag === 'TRUE' || firstLoginFlag === '1';

  const teacherToken = Utilities.getUuid();
  CacheService.getScriptCache().put('TCH_SESSION_' + teacherToken, JSON.stringify({
    account: cleanAccount,
    name: teacherName,
    assignedClass: assignedClass,
    rawAssignedClass: rawAssignedClass,
    mustChangePassword: mustChangePassword
  }), 7200);

  return {
    status: 'success',
    token: teacherToken,
    teacher: {
      account: cleanAccount,
      name: teacherName,
      assignedClass: assignedClass,
      rawAssignedClass: rawAssignedClass,
      mustChangePassword: mustChangePassword,
      email: String(matchedRow[5] || '').trim()
    },
    classList: assignedClass ? [assignedClass] : []
  };
}

function changeTeacherPassword(teacherToken, currentPassword, newPassword) {
  const session = verifyTeacherSession_(teacherToken);
  if (!session) {
    return { status: 'error', message: '導師登入階段已逾時，請重新登入！' };
  }
  if (!currentPassword || !newPassword) {
    return { status: 'error', message: '請填寫目前密碼與新密碼！' };
  }
  if (String(newPassword).length < 6) {
    return { status: 'error', message: '新密碼長度至少需 6 個字元！' };
  }
  if (String(newPassword) === String(currentPassword)) {
    return { status: 'error', message: '新密碼不可與目前密碼相同！' };
  }

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      return { status: 'error', message: '伺服器忙碌中，請稍後再試。' };
    }
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('導師名單');
    if (!sheet) return { status: 'error', message: '找不到「導師名單」工作表！' };

    const rows = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < rows.length; i++) {
      const rowAcc = String(rows[i][0] || '').trim().toLowerCase();
      if (rowAcc && rowAcc === String(session.account).toLowerCase()) {
        const storedPwd = String(rows[i][3] || '').trim();
        if (!verifyScorePassword_(currentPassword, rowAcc, storedPwd, false)) {
          return { status: 'error', message: '目前密碼不正確，請重新確認！' };
        }
        const hashed = hashScorePassword_(rowAcc, newPassword);
        const pwdCell = sheet.getRange(i + 1, 4);
        if (typeof pwdCell.setNumberFormat === 'function') pwdCell.setNumberFormat('@');
        pwdCell.setValue(hashed);
        sheet.getRange(i + 1, 5).setValue(false);

        session.mustChangePassword = false;
        CacheService.getScriptCache().put('TCH_SESSION_' + String(teacherToken).trim(), JSON.stringify(session), 7200);
        return {
          status: 'success',
          mustChangePassword: false,
          message: '導師密碼已更新，現在可查詢負責班級的選社名單！'
        };
      }
    }
    return { status: 'error', message: '查無此教師帳號！' };
  } catch (err) {
    console.error('changeTeacherPassword error: ' + err.message);
    return { status: 'error', message: '導師密碼變更失敗：' + err.message };
  } finally {
    lock.releaseLock();
  }
}

function resolveTeacherOrAdminAuth_(authToken, requestedClass) {
  if (verifyAdminSession_(authToken)) {
    return { role: 'admin', targetClass: normalizeClassCode_(requestedClass) };
  }
  const tSession = verifyTeacherSession_(authToken);
  if (!tSession) {
    throw new Error('403 Unauthorized: 導師專區存取未獲授權，請先以教師帳號密碼登入！');
  }
  if (tSession.mustChangePassword) {
    throw new Error('403 PasswordChangeRequired: 首次登入須先變更預設密碼後才可查詢班級名單！');
  }
  const target = requestedClass ? normalizeClassCode_(requestedClass) : tSession.assignedClass;
  if (!tSession.assignedClass || !isClassMatch_(target, tSession.assignedClass)) {
    throw new Error(`403 Unauthorized: 導師僅能查詢負責班級（${tSession.assignedClass}）的選社名單！`);
  }
  return { role: 'teacher', targetClass: tSession.assignedClass, teacher: tSession };
}

/**
 * 👨‍🏫 智慧行政 4：導師班級專區查核與 LINE 催繳文案
 */
function getHomeroomClassData(className, authToken) {
  const auth = resolveTeacherOrAdminAuth_(authToken, className);
  const targetClass = auth.targetClass;
  if (!targetClass) {
    return { status: 'error', message: '請指定要查詢的班級代碼！' };
  }

  const ss = getSpreadsheet();
  const studentSheet = getStudentSheet_(ss);
  if (!studentSheet) return { status: 'error', message: '查無學生名單工作表！' };
  const data = studentSheet.getDataRange().getDisplayValues();
  const cols = getStudentColIndex_(data[0]);

  const enrolled = [];
  const unassigned = [];

  for (let i = 1; i < data.length; i++) {
    if (isClassMatch_(data[i][cols.className], targetClass)) {
      const item = {
        studentId: String(data[i][cols.studentId] || '').trim(),
        seat: padSeatNo_(data[i][cols.seat]),
        name: String(data[i][cols.name] || '').trim(),
        club: String(data[i][cols.assignedClub] || '').trim()
      };
      if (item.club) enrolled.push(item);
      else unassigned.push(item);
    }
  }

  enrolled.sort((a, b) => (parseInt(a.seat, 10) || 0) - (parseInt(b.seat, 10) || 0));
  unassigned.sort((a, b) => (parseInt(a.seat, 10) || 0) - (parseInt(b.seat, 10) || 0));

  const unassignedNames = unassigned.map(s => `${s.seat}號${s.name}`).join('、');
  const lineNotice = `【${targetClass} 班社團選社進度通知】
親愛的家長與同學好：
本學期社團選社即將截止，貴班尚有 ${unassigned.length} 位同學未完成選填：
👉 未選名單：${unassignedNames || '全數已完成選填！'}
請把握探索機會，使用 7 碼學號登入「大溪國中AI選社系統」完成登記。逾期將由學務處進行適性分流。感謝大家配合！`;

  return {
    status: 'success',
    className: targetClass,
    total: enrolled.length + unassigned.length,
    enrolledCount: enrolled.length,
    unassignedCount: unassigned.length,
    enrolledList: enrolled,
    unassignedList: unassigned,
    noticeText: lineNotice
  };
}

// ==================== 🧹 試算表分頁健檢與清理（保留系統必要分頁，安全刪除多餘分頁） ====================
function getSpreadsheetAudit(adminToken) {
  assertAdminAuth_(adminToken);
  const ss = getSpreadsheet();
  const requiredSet = {};
  CONFIG.REQUIRED_SHEETS.forEach(n => { requiredSet[n] = true; });

  const sheets = ss.getSheets().map(sheet => {
    const name = sheet.getName();
    const values = sheet.getDataRange().getValues();
    const nonEmpty = values.filter(r => r.some(c => String(c).trim() !== ''));
    const headers = nonEmpty.length > 0
      ? nonEmpty[0].map(c => String(c).trim()).filter(Boolean).slice(0, 8)
      : [];
    const dataRows = Math.max(0, nonEmpty.length - 1);
    return {
      name: name,
      usedByApp: !!requiredSet[name],
      dataRows: dataRows,
      headers: headers
    };
  });

  return { status: 'success', sheets: sheets };
}

function cleanupUnusedSheets(adminToken, targetNames) {
  assertAdminAuth_(adminToken);
  if (!Array.isArray(targetNames) || targetNames.length === 0) {
    return { status: 'error', message: '請先勾選要刪除的未使用分頁！' };
  }

  const requiredSet = {};
  CONFIG.REQUIRED_SHEETS.forEach(n => { requiredSet[n] = true; });

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      return { status: 'error', message: '伺服器忙碌中，請稍後再試。' };
    }

    const ss = getSpreadsheet();
    const wantDelete = {};
    targetNames.forEach(n => {
      const s = String(n || '').trim();
      if (s) wantDelete[s] = true;
    });

    const deleted = [];
    const skippedProtected = [];

    ss.getSheets().forEach(sheet => {
      const name = sheet.getName();
      if (!wantDelete[name]) return;
      if (requiredSet[name]) {
        skippedProtected.push(name);
        return;
      }
      if (ss.getSheets().length <= 1) return;
      ss.deleteSheet(sheet);
      deleted.push(name);
    });

    const remaining = ss.getSheets().map(s => s.getName());
    return {
      status: 'success',
      deleted: deleted,
      skippedProtected: skippedProtected,
      remaining: remaining,
      message: deleted.length > 0
        ? `已成功刪除 ${deleted.length} 個未使用分頁：${deleted.join('、')}`
        : '沒有符合刪除條件的未使用分頁（系統必要分頁已受保護）。'
    };
  } catch (err) {
    console.error('cleanupUnusedSheets error: ' + err.message);
    return { status: 'error', message: '清理分頁時發生異常：' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// ==================== 📐 試算表全分頁適當欄寬與自動換列排版引擎 ====================
const COLUMN_WIDTH_RULES_ = [
  { pattern: /^(班級|座號|負責班級|人數上限|已錄取人數|出生月日|首次登入標記)$/, min: 82, max: 120 },
  { pattern: /^第\d+週簽到$/, min: 92, max: 120 },
  { pattern: /^(姓名|教師姓名|教師帳號|帳號|學號|授課教師|指導教師|社團類別|設定項目)$/, min: 112, max: 185 },
  { pattern: /^(身分證字號|身分證後四碼|選填時間)$/, min: 135, max: 195 },
  { pattern: /^(社團名稱|錄取社團|活動地點|第一志願|第二志願|第三志願|學生Email|公務信箱|設定值)$/, min: 155, max: 255 },
  { pattern: /^(密碼|登入密碼|社團簡介|先備要求與材料費|分發備註|保障身分鎖定|健康安全提醒|說明)$/, min: 210, max: 360 }
];

function measureDisplayUnits_(val) {
  const text = String(val === undefined || val === null ? '' : val).trim();
  if (!text) return 0;
  const lines = text.split(/\r?\n/);
  let maxLine = 0;
  for (let i = 0; i < lines.length; i++) {
    let units = 0;
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      units += line.charCodeAt(j) > 255 ? 2 : 1;
    }
    if (units > maxLine) maxLine = units;
  }
  return maxLine;
}

function getColumnWidthBounds_(headerText) {
  const h = String(headerText || '').trim();
  for (let i = 0; i < COLUMN_WIDTH_RULES_.length; i++) {
    if (COLUMN_WIDTH_RULES_[i].pattern.test(h)) {
      return COLUMN_WIDTH_RULES_[i];
    }
  }
  return { min: 96, max: 300 };
}

/**
 * 對單一工作表的每一欄位啟用自動換列、垂直置中並計算最佳欄寬
 */
function formatSheetLayout_(sheet) {
  if (!sheet) return null;
  const sheetName = sheet.getName();
  const lastRow = Math.max(sheet.getLastRow(), 0);
  const lastCol = Math.max(sheet.getLastColumn(), 0);
  const maxRows = Math.max(typeof sheet.getMaxRows === 'function' ? sheet.getMaxRows() : lastRow, lastRow, 1);
  const maxCols = Math.max(typeof sheet.getMaxColumns === 'function' ? sheet.getMaxColumns() : lastCol, lastCol, 1);

  // 所有欄位（包含後續新增或備用欄）皆啟用自動換列
  sheet.getRange(1, 1, maxRows, maxCols).setWrap(true);

  if (lastRow >= 1 && lastCol >= 1) {
    const activeRange = sheet.getRange(1, 1, lastRow, lastCol);
    if (typeof activeRange.setVerticalAlignment === 'function') {
      activeRange.setVerticalAlignment('middle');
    }

    const values = activeRange.getValues();
    const isAttendance = (sheetName === '社團點名簽到冊' && values.length >= 3 && String(values[2][0] || '').trim() === '社團名稱');
    const headerRowIdx = isAttendance ? 2 : 0;
    const scanLimit = Math.min(values.length, headerRowIdx + 201);

    for (let c = 0; c < lastCol; c++) {
      const header = String((values[headerRowIdx] && values[headerRowIdx][c]) || '').trim();
      const bounds = getColumnWidthBounds_(header);
      let maxUnits = measureDisplayUnits_(header) + (header ? 2 : 0);
      for (let r = headerRowIdx + 1; r < scanLimit; r++) {
        const u = measureDisplayUnits_(values[r] ? values[r][c] : '');
        if (u > maxUnits) maxUnits = u;
      }
      const computed = Math.round(maxUnits * 9 + 28);
      const width = Math.max(bounds.min, Math.min(bounds.max, computed));
      sheet.setColumnWidth(c + 1, width);
    }

    if (maxCols > lastCol && typeof sheet.setColumnWidths === 'function') {
      sheet.setColumnWidths(lastCol + 1, maxCols - lastCol, 110);
    }
    if (typeof sheet.setFrozenRows === 'function' && lastRow > headerRowIdx + 1) {
      sheet.setFrozenRows(headerRowIdx + 1);
    }
    try {
      if (typeof sheet.autoResizeRows === 'function') {
        sheet.autoResizeRows(1, lastRow);
      }
    } catch (e) {}
  } else if (typeof sheet.setColumnWidths === 'function') {
    sheet.setColumnWidths(1, maxCols, 120);
  }

  return { name: sheetName, columns: Math.max(lastCol, maxCols), wrappedRows: maxRows };
}

function formatAllSheets_(ss) {
  const results = ss.getSheets().map(s => formatSheetLayout_(s)).filter(Boolean);
  PropertiesService.getScriptProperties().setProperty('SHEET_LAYOUT_V', '1');
  return results;
}

function formatAllSheetsLayout(adminToken) {
  assertAdminAuth_(adminToken);
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      return { status: 'error', message: '伺服器忙碌中，請稍後再試。' };
    }
    const results = formatAllSheets_(getSpreadsheet());
    return {
      status: 'success',
      sheets: results,
      message: `已將試算表全部 ${results.length} 個分頁套用適當欄寬與自動換列！`
    };
  } catch (err) {
    console.error('formatAllSheetsLayout error: ' + err.message);
    return { status: 'error', message: '調整試算表排版時發生異常：' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// ==================== 🔄 從「成績查詢系統」唯讀複製學生與導師名單（絕不寫回來源） ====================

function getSheetDisplayRows_(sheet) {
  const range = sheet.getDataRange();
  return typeof range.getDisplayValues === 'function' ? range.getDisplayValues() : range.getValues();
}

function findHeaderCol_(headers, names, fallbackIdx) {
  for (let n = 0; n < names.length; n++) {
    const target = names[n];
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c] || '').trim() === target) return c;
    }
  }
  return fallbackIdx;
}

function syncDirectoryFromScoreDb_(ss) {
  const srcId = CONFIG.SCORE_SOURCE_SPREADSHEET_ID;
  if (!srcId || srcId === ss.getId()) {
    return { status: 'skipped', message: '來源試算表與目前試算表相同或未設定。' };
  }

  let srcSs = null;
  try {
    srcSs = SpreadsheetApp.openById(srcId);
  } catch (err) {
    return {
      status: 'error',
      message: '無法讀取成績查詢系統試算表（請確認共用權限）：' + err.message
    };
  }

  if (!srcSs || srcSs.getId() === ss.getId()) {
    return { status: 'skipped', message: '跳過同源試算表同步。' };
  }

  const srcStudentSheet = srcSs.getSheetByName('學生名單');
  const srcTeacherSheet = srcSs.getSheetByName('導師名單');
  if (!srcStudentSheet && !srcTeacherSheet) {
    return { status: 'error', message: '來源試算表找不到「學生名單」或「導師名單」工作表！' };
  }

  let studentsCount = 0;
  let teachersCount = 0;
  let preservedSelections = 0;

  // 1. 複製「學生名單」->「學生名單」（取代舊學生名冊，保留既有選社成果）
  if (srcStudentSheet) {
    const srcRows = getSheetDisplayRows_(srcStudentSheet);
    if (srcRows.length >= 1) {
      const sh = srcRows[0];
      const idxAcc = findHeaderCol_(sh, ['學號'], 0);
      const idxName = findHeaderCol_(sh, ['姓名'], 1);
      const idxClass = findHeaderCol_(sh, ['班級'], 2);
      const idxSeat = findHeaderCol_(sh, ['座號'], 3);
      const idxId4 = findHeaderCol_(sh, ['身分證後四碼', '身分證字號'], 4);
      const idxBirth = findHeaderCol_(sh, ['出生月日'], 5);
      const idxPwd = findHeaderCol_(sh, ['密碼', '登入密碼'], 6);

      const targetHeaders = [
        '學號', '姓名', '班級', '座號', '身分證後四碼', '出生月日', '密碼',
        '學生Email', '第一志願', '第二志願', '第三志願', '錄取社團', '選填時間',
        '分發備註', '保障身分鎖定', '健康安全提醒'
      ];

      let targetStudentSheet = ss.getSheetByName('學生名單');
      const legacyRoster = ss.getSheetByName('學生名冊');
      if (!targetStudentSheet && legacyRoster) {
        try {
          legacyRoster.setName('學生名單');
          targetStudentSheet = legacyRoster;
        } catch (e) {
          targetStudentSheet = ss.insertSheet('學生名單');
        }
      } else if (!targetStudentSheet) {
        targetStudentSheet = ss.insertSheet('學生名單');
      }

      // 從現有「學生名單」與舊「學生名冊」中完整讀取並保留已選填之社團志願紀錄
      const existingById = {};
      const existingByClassSeat = {};

      const collectExisting_ = function(sheet) {
        if (!sheet || sheet.getLastRow() <= 1) return;
        const rows = getSheetDisplayRows_(sheet);
        if (rows.length <= 1) return;
        const cols = getStudentColIndex_(rows[0] || targetHeaders);
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const sid = String(r[cols.studentId] || '').trim().toLowerCase();
          const cls = normalizeClassCode_(r[cols.className]);
          const seat = padSeatNo_(r[cols.seat]);
          const record = {
            email: String(r[cols.email] || '').trim(),
            pref1: String(r[cols.pref1] || '').trim(),
            pref2: String(r[cols.pref2] || '').trim(),
            pref3: String(r[cols.pref3] || '').trim(),
            assignedClub: String(r[cols.assignedClub] || '').trim(),
            selectedTime: String(r[cols.selectedTime] || '').trim(),
            note: String(r[cols.note] || '').trim(),
            lockedClub: String(r[cols.lockedClub] || '').trim(),
            healthNotice: String(r[cols.healthNotice] || '').trim(),
            password: String(r[cols.password] || '').trim()
          };
          const isDemoPlaceholder = /^daxi_\d+@example\.com$/i.test(record.email) &&
            !record.assignedClub && !record.pref1 && !record.lockedClub;
          if (isDemoPlaceholder) continue;
          if (sid) existingById[sid] = record;
          if (cls && seat) existingByClassSeat[cls + '_' + seat] = record;
        }
      };

      if (legacyRoster) collectExisting_(legacyRoster);
      if (targetStudentSheet && targetStudentSheet !== legacyRoster) collectExisting_(targetStudentSheet);

      const nextRows = [targetHeaders];
      for (let i = 1; i < srcRows.length; i++) {
        const r = srcRows[i];
        const sid = String(r[idxAcc] || '').trim();
        const name = String(r[idxName] || '').trim();
        if (!sid && !name) continue;

        const cls = normalizeClassCode_(r[idxClass]);
        const seat = padSeatNo_(r[idxSeat]);
        const idLast4 = String(r[idxId4] || '').trim().toUpperCase();
        const birthMMDD = padBirthMMDD_(r[idxBirth]);
        const srcPwd = String(r[idxPwd] || '').trim();

        const prev = (sid && existingById[sid.toLowerCase()]) || existingByClassSeat[cls + '_' + seat] || null;
        if (prev && (prev.assignedClub || prev.pref1 || prev.lockedClub)) {
          preservedSelections++;
        }

        const effectivePassword = (prev && prev.password && prev.password.indexOf('sha256$') === 0)
          ? prev.password
          : (srcPwd || (idLast4 && birthMMDD ? idLast4 + birthMMDD : ''));

        nextRows.push([
          sid,
          name,
          cls,
          seat,
          idLast4,
          birthMMDD,
          effectivePassword,
          prev ? prev.email : '',
          prev ? prev.pref1 : '',
          prev ? prev.pref2 : '',
          prev ? prev.pref3 : '',
          prev ? prev.assignedClub : '',
          prev ? prev.selectedTime : '',
          prev ? prev.note : '',
          prev ? prev.lockedClub : '',
          prev ? prev.healthNotice : ''
        ]);
        studentsCount++;
      }

      if (typeof targetStudentSheet.clearContents === 'function') {
        targetStudentSheet.clearContents();
      }
      const textCols = [1, 3, 4, 5, 6, 7]; // 學號, 班級, 座號, 身分證後四碼, 出生月日, 密碼
      textCols.forEach(c => {
        const rng = targetStudentSheet.getRange(1, c, Math.max(nextRows.length, 1), 1);
        if (typeof rng.setNumberFormat === 'function') rng.setNumberFormat('@');
      });
      targetStudentSheet.getRange(1, 1, nextRows.length, 16).setValues(nextRows);
      targetStudentSheet.getRange(1, 1, 1, 16).setBackground('#0f9d58').setFontColor('#ffffff').setFontWeight('bold');
      formatSheetLayout_(targetStudentSheet);

      // 若舊「學生名冊」分頁仍然存在且與新表不同，依使用者需求予以刪除
      const legacySheetToDelete = ss.getSheetByName('學生名冊');
      if (legacySheetToDelete && legacySheetToDelete !== targetStudentSheet) {
        try { ss.deleteSheet(legacySheetToDelete); } catch (e) { console.warn('Could not delete 學生名冊: ' + e.message); }
      }
    }
  }

  // 2. 複製「導師名單」->「導師名單」（保留社團內已啟用之 sha256 密碼）
  if (srcTeacherSheet) {
    const srcRows = getSheetDisplayRows_(srcTeacherSheet);
    if (srcRows.length >= 1) {
      const th = srcRows[0];
      const idxAcc = findHeaderCol_(th, ['教師帳號', '帳號'], 0);
      const idxName = findHeaderCol_(th, ['教師姓名', '姓名'], 1);
      const idxClass = findHeaderCol_(th, ['負責班級', '班級'], 2);
      const idxPwd = findHeaderCol_(th, ['密碼'], 3);
      const idxFirst = findHeaderCol_(th, ['首次登入標記'], 4);
      const idxEmail = findHeaderCol_(th, ['公務信箱', 'Email'], 5);

      const teacherHeaders = ['教師帳號', '教師姓名', '負責班級', '密碼', '首次登入標記', '公務信箱'];
      let targetTeacherSheet = ss.getSheetByName('導師名單');
      if (!targetTeacherSheet) {
        targetTeacherSheet = ss.insertSheet('導師名單');
      }

      const existingRows = targetTeacherSheet.getLastRow() > 0 ? getSheetDisplayRows_(targetTeacherSheet) : [];
      const existingTeachers = {};
      for (let i = 1; i < existingRows.length; i++) {
        const acc = String(existingRows[i][0] || '').trim().toLowerCase();
        if (acc) {
          existingTeachers[acc] = {
            password: String(existingRows[i][3] || '').trim(),
            firstLogin: String(existingRows[i][4] || '').trim().toUpperCase()
          };
        }
      }

      const nextRows = [teacherHeaders];
      for (let i = 1; i < srcRows.length; i++) {
        const r = srcRows[i];
        const acc = String(r[idxAcc] || '').trim();
        if (!acc) continue;

        const name = String(r[idxName] || '').trim();
        const assignedClass = String(r[idxClass] || '').trim();
        const normCls = normalizeClassCode_(assignedClass);
        const srcPwd = String(r[idxPwd] || '').trim() || (normCls ? normCls + normCls : '');
        const srcFirstRaw = String(r[idxFirst] || '').trim().toUpperCase();
        const srcFirst = srcFirstRaw === '' ? true : (srcFirstRaw === 'TRUE' || srcFirstRaw === '1');
        const email = String(r[idxEmail] || '').trim();

        const prev = existingTeachers[acc.toLowerCase()];
        const keepLocalChangedPwd = prev && prev.password.indexOf('sha256$') === 0 && prev.firstLogin === 'FALSE';

        nextRows.push([
          acc,
          name,
          assignedClass,
          keepLocalChangedPwd ? prev.password : srcPwd,
          keepLocalChangedPwd ? false : srcFirst,
          email
        ]);
        teachersCount++;
      }

      if (typeof targetTeacherSheet.clearContents === 'function') {
        targetTeacherSheet.clearContents();
      }
      [1, 3, 4].forEach(c => {
        const rng = targetTeacherSheet.getRange(1, c, Math.max(nextRows.length, 1), 1);
        if (typeof rng.setNumberFormat === 'function') rng.setNumberFormat('@');
      });
      targetTeacherSheet.getRange(1, 1, nextRows.length, 6).setValues(nextRows);
      targetTeacherSheet.getRange(1, 1, 1, 6).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
      formatSheetLayout_(targetTeacherSheet);
    }
  }

  PropertiesService.getScriptProperties().setProperty('SCORE_SYNC_V', '20261113_student_list');
  return {
    status: 'success',
    studentsCount: studentsCount,
    teachersCount: teachersCount,
    preservedSelections: preservedSelections,
    message: `已從成績查詢系統唯讀複製 ${studentsCount} 位學生、${teachersCount} 位導師至社團試算表（未更動成績查詢系統，已保留 ${preservedSelections} 筆選社紀錄）！`
  };
}

function syncUsersFromScoreSystem(adminToken) {
  assertAdminAuth_(adminToken);
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      return { status: 'error', message: '伺服器忙碌中，請稍後再試。' };
    }
    return syncDirectoryFromScoreDb_(getSpreadsheet());
  } catch (err) {
    console.error('syncUsersFromScoreSystem error: ' + err.message);
    return { status: 'error', message: '同步名冊時發生異常：' + err.message };
  } finally {
    lock.releaseLock();
  }
}
