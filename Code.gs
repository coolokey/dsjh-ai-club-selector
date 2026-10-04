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
 */

// ==================== 系統設定與常數 ====================
const CONFIG = {
  DEFAULT_PASSWORD: 'admin888',
  DEFAULT_TITLE: '大溪國中 AI 智慧社團選社系統',
  GEMINI_MODEL: 'gemini-1.5-flash',
  LOCK_TIMEOUT_MS: 30000,
  MAX_PER_CLASS_PER_CLUB: 4, // 單一社團各班人數上限（防抱團）
  DEFAULT_SALT: 'DSJH_SECURE_SALT_2026',
  SESSION_EXPIRE_SEC: 7200 // 管理員 Token 效期 2 小時
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

  const newSheet = SpreadsheetApp.create('大溪國中AI社團選社資料庫');
  props.setProperty('SPREADSHEET_ID', newSheet.getId());
  _cachedSpreadsheet = newSheet;
  return _cachedSpreadsheet;
}

/**
 * 確保三大核心工作表完整存在，初次執行時自動灌入示範資料
 */
function ensureSheetExists() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('IS_INITIALIZED') === 'true') {
    return; // 已初始化完成，跳過檢查以提升效能
  }

  const ss = getSpreadsheet();

  // 1. 社團設定表
  let clubSheet = ss.getSheetByName('社團設定');
  if (!clubSheet) {
    clubSheet = ss.insertSheet('社團設定');
    clubSheet.appendRow(['社團名稱', '人數上限', '已錄取人數', '授課教師', '活動地點', '社團簡介', '先備要求與材料費', '社團類別']);
    clubSheet.getRange(1, 1, 1, 8).setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');

    const demoClubs = [
      ['AI機器人創客社', 15, 0, '李組長', '科技創客教室', '學習 Arduino 感測器、Micro:bit 與程式創作，實作智能小車與物聯網。', '自備筆電或平板佳，材料費 200 元', '科技創客'],
      ['熱血籃球戰術社', 25, 0, '陳教練', '風雨球場A', '基礎運球、團隊防守跑位、半場戰術演練與分組對抗，鍛鍊體能與團隊精神。', '請穿著運動服裝與籃球鞋', '體育競技'],
      ['數位動漫與繪畫社', 20, 0, '王老師', '電腦教室二', '電繪板基礎教學、角色骨架設計、分鏡繪製與 AI 輔助著色探索。', '無基礎可，提供教室電繪板', '視覺藝術'],
      ['烏克麗麗與吉他彈唱社', 18, 0, '林老師', '音樂教室B', '由淺入深學習和弦彈奏、節奏刷法與流行曲目彈唱，培養音樂美感與表演自信。', '歡迎自備樂器，備有部分公用琴', '音樂表演'],
      ['桌遊與邏輯推理社', 24, 0, '張老師', '七年級多功能教室', '精選德式策略桌遊、邏輯解謎密室與溝通推理遊戲，培養批判性思維與協作。', '無須自備道具，愛好思考者佳', '策略邏輯'],
      ['趣味生活科學實驗社', 16, 0, '黃老師', '理化實驗室三', '生活中的化學變色、大氣壓力水火箭、分子料理與電磁魔法，探索科學奧秘。', '材料費 150 元，需穿著實驗圍裙', '自然實驗'],
      ['校園新聞播報與攝影社', 15, 0, '趙老師', '視聽研討室', '採訪技巧、單眼與手機攝影構圖、剪輯軟體操作與重大活動實地報導實習。', '無經驗可，適合喜愛表達與拍攝者', '語文傳播']
    ];
    clubSheet.getRange(2, 1, demoClubs.length, 8).setValues(demoClubs);
  }

  // 2. 學生名冊表（擴充 Email、保障鎖定、健康提醒）
  let studentSheet = ss.getSheetByName('學生名冊');
  if (!studentSheet) {
    studentSheet = ss.insertSheet('學生名冊');
    studentSheet.appendRow([
      '班級', '座號', '姓名', '身分證字號', '學生Email',
      '第一志願', '第二志願', '第三志願', '錄取社團', '選填時間',
      '分發備註', '保障身分鎖定', '健康安全提醒'
    ]);
    studentSheet.getRange(1, 1, 1, 13).setBackground('#0f9d58').setFontColor('#ffffff').setFontWeight('bold');

    const demoStudents = [
      ['701', '01', '王大明', 'A123456789', 'daxi_70101@example.com', '', '', '', '', '', '', '', ''],
      ['701', '02', '李小美', 'B223456789', 'daxi_70102@example.com', '', '', '', '', '', '', '', ''],
      ['701', '03', '張志豪', 'C123456789', 'daxi_70103@example.com', '', '', '', '', '', '', '校隊保障(籃球)', ''],
      ['701', '04', '林佩君', 'D223456789', 'daxi_70104@example.com', '', '', '', '', '', '', '', '氣喘，劇烈運動需注意'],
      ['702', '01', '陳建宏', 'E123456789', 'daxi_70201@example.com', '', '', '', '', '', '', '', ''],
      ['702', '02', '黃雅婷', 'F223456789', 'daxi_70202@example.com', '', '', '', '', '', '', '', ''],
      ['702', '03', '吳宗憲', 'G123456789', 'daxi_70203@example.com', '', '', '', '', '', '', '', ''],
      ['702', '04', '蔡依林', 'H223456789', 'daxi_70204@example.com', '', '', '', '', '', '', '', '']
    ];
    studentSheet.getRange(2, 1, demoStudents.length, 13).setValues(demoStudents);
  }

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
      ['EMAIL_NOTIFICATION_ENABLED', 'true', '是否啟用錄取結果同步寄送信箱 (true/false)']
    ];
    configSheet.getRange(2, 1, defaultConfigs.length, 3).setValues(defaultConfigs);
  }

  const defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 3) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

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

// ==================== 管理員權限驗證攔截器 ====================
function verifyAdminSession_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get('ADMIN_SESSION_' + token) === 'ACTIVE';
}

function assertAdminAuth_(token) {
  if (!verifyAdminSession_(token) ||
      (PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || CONFIG.DEFAULT_PASSWORD) === CONFIG.DEFAULT_PASSWORD) {
    throw new Error('403 Unauthorized: 未經授權的管理端操作或 Session 已過期，請重新登入管理員帳號！');
  }
}

function loginAdmin(pwd) {
  const realPwd = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || CONFIG.DEFAULT_PASSWORD;
  if (String(pwd).trim() === realPwd) {
    const adminToken = Utilities.getUuid();
    CacheService.getScriptCache().put('ADMIN_SESSION_' + adminToken, 'ACTIVE', CONFIG.SESSION_EXPIRE_SEC);
    return {
      status: 'success',
      token: adminToken,
      isDefault: (realPwd === CONFIG.DEFAULT_PASSWORD)
    };
  }
  return { status: 'error', message: '管理密碼錯誤！' };
}

function changeAdminPassword(adminToken, oldPwd, newPwd) {
  if (!verifyAdminSession_(adminToken)) throw new Error('403 Unauthorized');
  const props = PropertiesService.getScriptProperties();
  const realPwd = props.getProperty('ADMIN_PASSWORD') || CONFIG.DEFAULT_PASSWORD;

  if (String(oldPwd).trim() !== realPwd) {
    return { status: 'error', message: '舊密碼不正確！' };
  }
  if (!newPwd || String(newPwd).trim().length < 8 || String(newPwd).trim() === CONFIG.DEFAULT_PASSWORD) {
    return { status: 'error', message: '新密碼至少 8 碼，且不得使用預設密碼！' };
  }

  props.setProperty('ADMIN_PASSWORD', String(newPwd).trim());
  return { status: 'success', message: '管理密碼修改成功！' };
}

function saveSystemSettings(adminToken, newSettings) {
  assertAdminAuth_(adminToken);
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('系統設定');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    if (key === 'SYSTEM_TITLE' && newSettings.title !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.title);
    else if (key === 'SELECTION_MODE' && newSettings.mode !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.mode);
    else if (key === 'OPEN_TIME' && newSettings.openTime !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.openTime);
    else if (key === 'CLOSE_TIME' && newSettings.closeTime !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.closeTime);
    else if (key === 'AI_ADVISOR_ENABLED' && newSettings.aiAdvisorEnabled !== undefined) sheet.getRange(i + 1, 2).setValue(String(newSettings.aiAdvisorEnabled));
    else if (key === 'MAX_PER_CLASS_PER_CLUB' && newSettings.maxPerClass !== undefined) sheet.getRange(i + 1, 2).setValue(newSettings.maxPerClass);
    else if (key === 'EMAIL_NOTIFICATION_ENABLED' && newSettings.emailNotificationEnabled !== undefined) sheet.getRange(i + 1, 2).setValue(String(newSettings.emailNotificationEnabled));
  }

  if (newSettings.geminiApiKey) {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', newSettings.geminiApiKey.trim());
  }

  return { status: 'success', message: '系統設定已儲存並即時生效！' };
}

// ==================== 學生端 API ====================

function getClassList() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('學生名冊');
  const data = sheet.getDataRange().getValues();
  const classSet = {};

  for (let i = 1; i < data.length; i++) {
    const cls = String(data[i][0]).trim();
    if (cls) classSet[cls] = true;
  }

  return Object.keys(classSet).sort();
}

function getStudentsByClass(className) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('學生名冊');
  const data = sheet.getDataRange().getValues();
  const list = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(className).trim()) {
      const rawName = String(data[i][2]).trim();
      list.push({
        seat: String(data[i][1]).trim(),
        name: rawName
      });
    }
  }

  list.sort((a, b) => parseInt(a.seat, 10) - parseInt(b.seat, 10));
  return list;
}

function verifyAndGetClubs(className, seat, idNum) {
  const ss = getSpreadsheet();
  const studentSheet = ss.getSheetByName('學生名冊');
  const sData = studentSheet.getDataRange().getValues();

  let student = null;
  const cleanId = String(idNum).trim().toUpperCase();

  for (let i = 1; i < sData.length; i++) {
    if (String(sData[i][0]).trim() === String(className).trim() &&
        String(sData[i][1]).trim() === String(seat).trim()) {
      const realId = String(sData[i][3]).trim().toUpperCase();

      if (cleanId === realId || (cleanId.length >= 4 && realId.endsWith(cleanId))) {
        student = {
          className: sData[i][0],
          seat: sData[i][1],
          name: sData[i][2],
          email: sData[i][4] || '',
          pref1: sData[i][5] || '',
          pref2: sData[i][6] || '',
          pref3: sData[i][7] || '',
          assignedClub: sData[i][8] || '',
          selectedTime: sData[i][9] || '',
          lockedClub: sData[i][11] || '',
          healthNotice: sData[i][12] || ''
        };
      } else {
        return { status: 'error', message: '身分證字號驗證不符，請重新確認！' };
      }
      break;
    }
  }

  if (!student) {
    return { status: 'error', message: '查無此班級座號學生資料！' };
  }

  const clubs = getClubList();
  const settings = getSystemSettings();

  return {
    status: 'success',
    student: student,
    clubs: clubs,
    settings: settings
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
function submitSelection(className, seat, idNum, selectedClub) {
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
    const studentSheet = ss.getSheetByName('學生名冊');
    const clubSheet = ss.getSheetByName('社團設定');

    const sData = studentSheet.getDataRange().getValues();
    const cData = clubSheet.getDataRange().getValues();

    let studentRowIndex = -1;
    let studentObj = null;
    const cleanId = String(idNum).trim().toUpperCase();

    // 1. 驗證學生身分與特殊保障
    for (let i = 1; i < sData.length; i++) {
      if (String(sData[i][0]).trim() === String(className).trim() &&
          String(sData[i][1]).trim() === String(seat).trim()) {
        const realId = String(sData[i][3]).trim().toUpperCase();
        if (cleanId === realId || (cleanId.length >= 4 && realId.endsWith(cleanId))) {
          studentRowIndex = i + 1;
          studentObj = {
            className: sData[i][0],
            seat: sData[i][1],
            name: sData[i][2],
            email: sData[i][4],
            assigned: sData[i][8],
            time: sData[i][9],
            locked: sData[i][11]
          };

          // 🛡️ 等冪性防重複報錯處理：若重複點擊送出相同社團，直接判定成功回傳憑證！
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
        } else {
          return { status: 'error', message: '身分證字號驗證失敗！' };
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
      if (String(sData[i][0]).trim() === String(className).trim() &&
          String(sData[i][8]).trim() === String(selectedClub).trim()) {
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
    studentSheet.getRange(studentRowIndex, 9).setValue(selectedClub);
    studentSheet.getRange(studentRowIndex, 10).setValue(timestamp);
    studentSheet.getRange(studentRowIndex, 11).setValue('即時選填成功');

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
function submitPreferences(className, seat, idNum, pref1, pref2, pref3) {
  const settings = getSystemSettings();
  const now = new Date();
  if (settings.openTime && now < new Date(settings.openTime)) return { status: 'error', message: '選填尚未開放！' };
  if (settings.closeTime && now > new Date(settings.closeTime)) return { status: 'error', message: '選填時間已截止！' };

  if (!pref1) return { status: 'error', message: '第一志願為必填項目！' };
  if (pref1 === pref2 || (pref2 && pref2 === pref3) || (pref3 && pref1 === pref3)) {
    return { status: 'error', message: '志願社團不可重複選擇！' };
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('學生名冊');
  const data = sheet.getDataRange().getValues();

  let studentRowIndex = -1;
  const cleanId = String(idNum).trim().toUpperCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(className).trim() &&
        String(data[i][1]).trim() === String(seat).trim()) {
      const realId = String(data[i][3]).trim().toUpperCase();
      if (cleanId === realId || (cleanId.length >= 4 && realId.endsWith(cleanId))) {
        studentRowIndex = i + 1;
      } else {
        return { status: 'error', message: '身分證字號驗證失敗！' };
      }
      break;
    }
  }

  if (studentRowIndex === -1) return { status: 'error', message: '查無此學生資料！' };

  const timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  // 一次性批次寫入第 6, 7, 8, 10, 11 欄
  sheet.getRange(studentRowIndex, 6, 1, 3).setValues([[pref1, pref2 || '', pref3 || '']]);
  sheet.getRange(studentRowIndex, 10).setValue(timestamp);
  sheet.getRange(studentRowIndex, 11).setValue('志願已登記，待分發');

  return {
    status: 'success',
    message: '志願序儲存成功！學務處將於選填截止後進行公平適性分發。',
    preferences: [pref1, pref2, pref3],
    timestamp: timestamp
  };
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

  const subject = `【大溪國中】社團選社錄取通知函 - ${student.name} 同學`;
  const serialNo = `DX-${Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd')}-${student.className}${student.seat}`;

  const htmlBody = `
  <div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 24px; text-align: center; color: white;">
      <h2 style="margin: 0; font-size: 20px; font-weight: bold;">桃園市立大溪國民中學</h2>
      <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.9;">113 學年度 社團選社錄取結果通知書</p>
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
  const studentSheet = ss.getSheetByName('學生名冊');
  const sData = studentSheet.getDataRange().getValues();

  let totalStudents = 0;
  let enrolledCount = 0;
  let unassignedCount = 0;
  let preferencesFilledCount = 0;

  for (let i = 1; i < sData.length; i++) {
    const cls = sData[i][0];
    if (cls) {
      totalStudents++;
      if (sData[i][8]) enrolledCount++;
      else unassignedCount++;

      if (sData[i][5]) preferencesFilledCount++;
    }
  }

  const clubs = getClubList();
  const settings = getSystemSettings();
  settings.spreadsheetUrl = ss.getUrl(); // 🛡️ 僅在管理者驗證後回傳

  return {
    status: 'success',
    stats: {
      totalStudents: totalStudents,
      enrolledCount: enrolledCount,
      unassignedCount: unassignedCount,
      preferencesFilledCount: preferencesFilledCount,
      enrollmentRate: totalStudents > 0 ? Math.round((enrolledCount / totalStudents) * 100) : 0
    },
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
    const studentSheet = ss.getSheetByName('學生名冊');
    const clubSheet = ss.getSheetByName('社團設定');

    const sData = studentSheet.getDataRange().getValues();
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

    // 2. 🛡️ 修復重大Bug：先將「既有已錄取或保障」學生納入佔位，絕不覆蓋清零！
    const pendingStudents = [];
    for (let i = 1; i < sData.length; i++) {
      const cls = String(sData[i][0]).trim();
      const currentAssigned = String(sData[i][8] || '').trim();
      const lockedClub = String(sData[i][11] || '').trim();

      const studentObj = {
        rowIdx: i,
        className: cls,
        seat: String(sData[i][1]).trim(),
        name: String(sData[i][2]).trim(),
        email: String(sData[i][4] || '').trim(),
        prefs: [sData[i][5], sData[i][6], sData[i][7]].map(p => String(p || '').trim()),
        assigned: currentAssigned,
        note: String(sData[i][10] || '').trim(),
        lotteryNo: null
      };

      // 若有保障鎖定，優先確保
      if (lockedClub && clubMap[lockedClub]) {
        studentObj.assigned = lockedClub;
        studentObj.note = '身分優先保障錄取';
        clubMap[lockedClub].assigned.push(studentObj);
        clubMap[lockedClub].classCounts[cls] = (clubMap[lockedClub].classCounts[cls] || 0) + 1;
        sData[i][8] = lockedClub;
        sData[i][10] = studentObj.note;
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
      sData[s.rowIdx][8] = s.assigned || '';
      sData[s.rowIdx][9] = s.assigned ? timestamp : '';
      sData[s.rowIdx][10] = s.note || '';
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
  const studentSheet = ss.getSheetByName('學生名冊');
  const clubSheet = ss.getSheetByName('社團設定');

  const sData = studentSheet.getDataRange().getValues();
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
    const email = String(sData[i][4] || '').trim();
    const assigned = String(sData[i][8] || '').trim();

    if (email && email.includes('@') && assigned && clubInfoMap[assigned]) {
      const student = {
        className: sData[i][0],
        seat: sData[i][1],
        name: sData[i][2],
        email: email
      };
      const ok = sendAdmissionEmail_(student, clubInfoMap[assigned], sData[i][9] || timestamp);
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
  const studentSheet = ss.getSheetByName('學生名冊');
  const clubSheet = ss.getSheetByName('社團設定');

  const sData = studentSheet.getDataRange().getValues();
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
    const assigned = String(sData[i][8] || '').trim();
    if (assigned && clubStudents[assigned]) {
      clubStudents[assigned].list.push({
        className: sData[i][0],
        seat: sData[i][1],
        name: sData[i][2],
        health: sData[i][12] || ''
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
  rows.push(['桃園市立大溪國民中學 社團活動學生點名簽到表（學務處備查聯）']);
  rows.push([
    '產表日期：' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy年MM月dd日'),
    '', '', '', '', '', '', '', '',
    '【緊急通報分機】學務處訓育組:211、健康中心:215'
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
  attSheet.getRange(3, 1, 1, 11).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');

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

  const doc = DocumentApp.create('大溪國中_AI智慧社團成果手冊與開課報告書');
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

function assertAdminOrTeacherAuth_(authCode) {
  if (verifyAdminSession_(authCode)) return true;
  const teacherPwd = PropertiesService.getScriptProperties().getProperty('TEACHER_PASSWORD') || 'teacher888';
  if (authCode && String(authCode).trim() === teacherPwd) return true;
  throw new Error('403 Unauthorized: 導師專區存取未獲授權，請輸入正確的導師通行碼！');
}

/**
 * 👨‍🏫 智慧行政 4：導師班級專區查核與 LINE 催繳文案
 */
function getHomeroomClassData(className, authCode) {
  assertAdminOrTeacherAuth_(authCode);
  const ss = getSpreadsheet();
  const studentSheet = ss.getSheetByName('學生名冊');
  const data = studentSheet.getDataRange().getValues();

  const enrolled = [];
  const unassigned = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(className).trim()) {
      const item = {
        seat: String(data[i][1]).trim(),
        name: String(data[i][2]).trim(),
        club: String(data[i][8] || '').trim()
      };
      if (item.club) enrolled.push(item);
      else unassigned.push(item);
    }
  }

  const unassignedNames = unassigned.map(s => `${s.seat}號${s.name}`).join('、');
  const lineNotice = `【${className} 班社團選社進度通知】
親愛的家長與同學好：
本學期社團選社即將截止，貴班尚有 ${unassigned.length} 位同學未完成選填：
👉 未選名單：${unassignedNames || '全數已完成選填！'}
請把握探索機會，使用手機進入「大溪國中AI選社系統」完成登記。逾期將由學務處進行適性分流。感謝大家配合！`;

  return {
    status: 'success',
    className: className,
    total: enrolled.length + unassigned.length,
    enrolledCount: enrolled.length,
    unassignedCount: unassigned.length,
    enrolledList: enrolled,
    unassignedList: unassigned,
    noticeText: lineNotice
  };
}
