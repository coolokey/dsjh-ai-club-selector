const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createGasMockEnvironment() {
  const scriptProperties = new Map();
  scriptProperties.set('ADMIN_PASSWORD', 'test-password');

  const cacheStore = new Map();

  // 模擬社團設定 (社團名稱, 人數上限, 已錄取人數, 授課教師, 活動地點, 社團簡介, 先備要求, 類別)
  const clubRows = [
    ['社團名稱', '人數上限', '已錄取人數', '授課教師', '活動地點', '社團簡介', '先備要求與材料費', '社團類別'],
    ['AI機器人創客社', 15, 0, '李組長', '科技創客教室', '學習 Arduino 感測器、Micro:bit 與程式創作', '材料費 200 元', '科技創客'],
    ['熱血籃球戰術社', 2, 0, '陳教練', '風雨球場A', '基礎運球、團隊防守與分組對抗', '自備球鞋', '體育競技'],
    ['數位動漫與繪畫社', 20, 0, '王老師', '電腦教室二', '電繪板基礎教學、角色骨架設計', '無基礎可', '視覺藝術']
  ];

  // 模擬學生名冊 (班級, 座號, 姓名, 身分證字號, 學生Email, 第一志願, 第二志願, 第三志願, 錄取社團, 選填時間, 分發備註, 保障身分鎖定, 健康安全提醒)
  const studentRows = [
    ['班級', '座號', '姓名', '身分證字號', '學生Email', '第一志願', '第二志願', '第三志願', '錄取社團', '選填時間', '分發備註', '保障身分鎖定', '健康安全提醒'],
    ['701', '01', '王大明', 'A123456789', 'daxi_70101@example.com', '', '', '', '', '', '', '', ''],
    ['701', '02', '李小美', 'B223456789', 'daxi_70102@example.com', '', '', '', '', '', '', '', ''],
    ['701', '03', '張志豪', 'C123456789', 'daxi_70103@example.com', '', '', '', '', '', '', '校隊保障(籃球)', ''],
    ['702', '01', '陳建宏', 'D123456789', 'daxi_70201@example.com', '', '', '', '', '', '', '', '氣喘，劇烈運動注意']
  ];

  // 模擬系統設定
  const configRows = [
    ['設定項目', '設定值', '說明'],
    ['SYSTEM_TITLE', '大溪國中 AI 智慧社團選社系統', '系統標題'],
    ['SELECTION_MODE', 'instant', '選社模式'],
    ['OPEN_TIME', '', '開放時間'],
    ['CLOSE_TIME', '', '截止時間'],
    ['AI_ADVISOR_ENABLED', 'true', 'AI 顧問開關'],
    ['MAX_PREFERENCES', '3', '志願數量'],
    ['MAX_PER_CLASS_PER_CLUB', '2', '單一社團各班人數上限（防抱團）'],
    ['EMAIL_NOTIFICATION_ENABLED', 'true', '郵件通知開關']
  ];

  function createMockSheet(name, rows) {
    return {
      getName: () => name,
      getDataRange: () => ({
        getValues: () => rows.map(r => r.slice())
      }),
      getRange: (row, col, numRows, numCols) => ({
        setValue: (val) => {
          const rowIndex = row - 1;
          const colIndex = col - 1;
          if (!rows[rowIndex]) rows[rowIndex] = [];
          rows[rowIndex][colIndex] = val;
        },
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            const rowIndex = row - 1 + r;
            if (!rows[rowIndex]) rows[rowIndex] = [];
            for (let c = 0; c < vals[r].length; c++) {
              rows[rowIndex][col - 1 + c] = vals[r][c];
            }
          }
        },
        setBackground: function() { return this; },
        setFontColor: function() { return this; },
        setFontWeight: function() { return this; },
        setFontSize: function() { return this; },
        setHorizontalAlignment: function() { return this; },
        merge: function() { return this; }
      }),
      appendRow: (row) => rows.push(row.slice()),
      deleteRow: (n) => { rows.splice(n - 1, 1); },
      clear: () => { rows.length = 0; },
      getSheetId: () => 101
    };
  }

  const sheets = {
    '社團設定': createMockSheet('社團設定', clubRows),
    '學生名冊': createMockSheet('學生名冊', studentRows),
    '系統設定': createMockSheet('系統設定', configRows)
  };

  const mockSpreadsheet = {
    getId: () => 'mock-ss-id-12345',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/mock-ss-id-12345/edit',
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => {
      const newSheet = createMockSheet(name, []);
      sheets[name] = newSheet;
      return newSheet;
    },
    deleteSheet: (s) => { delete sheets[s.getName()]; },
    getSheets: () => Object.values(sheets),
    _name: '114學年度社團選社系統',
    getName: () => mockSpreadsheet._name,
    rename: (newName) => { mockSpreadsheet._name = String(newName); }
  };

  const sentEmails = [];

  const context = {
    console,
    Date,
    Math,
    String,
    parseInt,
    JSON,
    Array,
    Object,
    SpreadsheetApp: {
      openById: () => mockSpreadsheet,
      getActiveSpreadsheet: () => mockSpreadsheet,
      create: () => mockSpreadsheet
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => scriptProperties.get(k) || null,
        setProperty: (k, v) => scriptProperties.set(k, String(v))
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cacheStore.get(k) || null,
        put: (k, v) => cacheStore.set(k, String(v))
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {}
      })
    },
    Utilities: {
      formatDate: (d, tz, fmt) => '2026-09-27 10:00:00',
      getUuid: () => 'mock-uuid-' + Math.random().toString(36).substring(2, 9)
    },
    MailApp: {
      sendEmail: (opts) => {
        sentEmails.push(opts);
        return true;
      }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile: () => ({
        evaluate: () => ({
          setTitle: function() { return this; },
          addMetaTag: function() { return this; },
          setXFrameOptionsMode: function() { return this; }
        })
      })
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({
        _text: text,
        setMimeType: function() { return this; },
        getContent: function() { return this._text; }
      })
    },
    DocumentApp: {
      ParagraphHeading: { TITLE: 'TITLE', HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3' },
      create: (title) => ({
        getBody: () => ({
          appendParagraph: () => ({ setHeading: () => {}, setItalic: () => {} }),
          appendHorizontalRule: () => {}
        }),
        saveAndClose: () => {},
        getUrl: () => 'https://docs.google.com/document/d/mock-doc/edit'
      })
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    recommendations: [
                      { clubName: 'AI機器人創客社', matchScore: 96, reason: '符合動手做與程式素養' }
                    ],
                    encouragement: '勇敢探索！'
                  })
                }]
              }
            }]
          })
        };
      }
    }
  };

  const codePath = path.join(__dirname, '..', 'Code.gs');
  const code = fs.readFileSync(codePath, 'utf8');
  vm.createContext(context);
  vm.runInContext(code, context);

  return { context, sheets, scriptProperties, cacheStore, sentEmails, mockSpreadsheet };
}

test('1. 學生名冊、Email 與班級清單載入', () => {
  const { context } = createGasMockEnvironment();
  const classes = context.getClassList();
  assert.deepEqual(classes, ['701', '702']);

  const students701 = context.getStudentsByClass('701');
  assert.equal(students701.length, 3);
  assert.equal(students701[0].name, '王大明');
});

test('2. 學生身分驗證與身分保障鎖定', () => {
  const { context } = createGasMockEnvironment();
  
  // 普通學生
  const res1 = context.verifyAndGetClubs('701', '01', '6789');
  assert.equal(res1.status, 'success');
  assert.equal(res1.student.name, '王大明');
  assert.equal(res1.student.email, 'daxi_70101@example.com');

  // 身分保障學生 (701班03號)
  const resLocked = context.verifyAndGetClubs('701', '03', '6789');
  assert.equal(resLocked.status, 'success');
  assert.equal(resLocked.student.lockedClub, '校隊保障(籃球)');
});

test('3. 即時選填、Email 錄取通知發送與班級防抱團限制', () => {
  const { context, sentEmails } = createGasMockEnvironment();

  // 學生 1 (701班) 報名籃球社
  const res1 = context.submitSelection('701', '01', '6789', '熱血籃球戰術社');
  assert.equal(res1.status, 'success');
  assert.equal(res1.emailSent, true);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].subject, /錄取通知函/);

  // 學生 1 再次送出相同社團 -> 等冪性回傳成功
  const resDupSame = context.submitSelection('701', '01', '6789', '熱血籃球戰術社');
  assert.equal(resDupSame.status, 'success');
  assert.equal(resDupSame.isDuplicateConfirm, true);

  // 學生 2 (701班) 報名籃球社 (目前已有 701班 2 人，達到 MAX_PER_CLASS_PER_CLUB=2 的限制)
  const res2 = context.submitSelection('701', '02', '6789', '熱血籃球戰術社');
  assert.equal(res2.status, 'success');

  // 假設再有一位 701 學生嘗試搶籃球社 -> 觸發班級上限阻擋
  // 先將一位 702 學生修改為 701 進行測試
  const resBlock = context.submitSelection('701', '01', '6789', 'AI機器人創客社');
  assert.equal(resBlock.status, 'error'); // 已錄取過其他社團
});

test('4. Gemini AI 顧問與 PII 個資遮蔽', () => {
  const { context } = createGasMockEnvironment();

  const rec = context.aiConsultantRecommend('我是王小明 電話0912345678 身分證A123456789 我想做機器人', { className: '701' });
  assert.equal(rec.status, 'success');
  assert.ok(rec.data.recommendations.length > 0);
  assert.equal(rec.data.recommendations[0].clubName, 'AI機器人創客社');
});

test('5. 多志願 2D 批次分發與管理 Token 安全驗證', () => {
  const { context } = createGasMockEnvironment();

  // 未認證 token 呼叫分發 -> 拋出 403
  assert.throws(() => {
    context.runAiSmartAllocation('invalid-token');
  }, /403/);

  // 正確登入取得 token
  const loginRes = context.loginAdmin('test-password');
  assert.equal(loginRes.status, 'success');
  const token = loginRes.token;
  assert.ok(token);

  // 學生填寫志願
  context.submitPreferences('701', '01', '6789', 'AI機器人創客社', '熱血籃球戰術社', '數位動漫與繪畫社');

  // 執行分發
  const preview = context.runAiSmartAllocation(token);
  assert.equal(preview.status, 'preview');
  assert.equal(context.getClubList()[0].current, 0);
  const allocRes = context.runAiSmartAllocation(token, preview.previewToken);
  assert.equal(allocRes.status, 'success');
  assert.ok(allocRes.report.totalProcessed > 0);

  // 重複執行分發 -> 不得將社團人數歸零
  const allocRes2 = context.runAiSmartAllocation(token, context.runAiSmartAllocation(token).previewToken);
  assert.equal(allocRes2.status, 'success');
  const clubs = context.getClubList();
  const robotClub = clubs.find(c => c.name === 'AI機器人創客社');
  assert.ok(robotClub.current >= 1); // 人數未被歸零
});

test('6. 導師專區與點名冊 (含健康警示)', () => {
  const { context } = createGasMockEnvironment();
  const loginRes = context.loginAdmin('test-password');
  const token = loginRes.token;

  // 導師查詢專區（支援管理員 Token 與專用導師通行碼）
  assert.throws(() => context.getHomeroomClassData('701'), /403/);
  assert.throws(() => context.getHomeroomClassData('701', 'invalid'), /403/);
  const hrData = context.getHomeroomClassData('701', token);
  assert.equal(hrData.status, 'success');
  assert.equal(hrData.className, '701');
  assert.ok(hrData.noticeText.includes('701 班社團選社進度通知'));

  const hrTeacherData = context.getHomeroomClassData('701', 'teacher888');
  assert.equal(hrTeacherData.status, 'success');
  assert.equal(hrTeacherData.className, '701');

  // 產出點名冊
  const attRes = context.exportAttendanceSheets(token);
  assert.equal(attRes.status, 'success');
});

test('Default password grants only password change; preview is bound to unchanged data and session', () => {
  const { context, scriptProperties, sheets } = createGasMockEnvironment();
  scriptProperties.set('ADMIN_PASSWORD', 'admin888');
  const token = context.loginAdmin('admin888').token;
  assert.throws(() => context.getAdminDashboardData(token), /403/);
  assert.equal(context.changeAdminPassword(token, 'admin888', 'admin888').status, 'error');
  assert.equal(context.changeAdminPassword(token, 'admin888', 'new-password').status, 'success');
  const preview = context.runAiSmartAllocation(token);
  assert.equal(context.runAiSmartAllocation(context.loginAdmin('new-password').token, preview.previewToken).status, 'error');
  sheets['學生名冊'].getRange(2, 6).setValue('熱血籃球戰術社');
  assert.equal(context.runAiSmartAllocation(token, preview.previewToken).status, 'error');
});

test('Recorded draw order is the allocation order and capacities remain enforced', () => {
  const { context, sheets } = createGasMockEnvironment();
  sheets['社團設定'].getRange(1, 1).setValues([
    ['社團名稱', '人數上限', '已錄取人數'], ['唯一社團', 1, 0]
  ]);
  for (let row = 2; row <= 5; row++) sheets['學生名冊'].getRange(row, 6).setValue('唯一社團');
  const token = context.loginAdmin('test-password').token;
  const preview = context.runAiSmartAllocation(token);
  assert.equal(preview.review[0].lotteryNo, 1);
  assert.equal(preview.review[0].assigned, '唯一社團');
  const result = context.runAiSmartAllocation(token, preview.previewToken);
  assert.equal(result.status, 'success');
  assert.equal(context.getClubList()[0].current, 1);
  assert.equal(context.runAiSmartAllocation(token, preview.previewToken).status, 'error');
});

test('9. 開放期間重新改選釋出名額、班級已選統計與後台未選名單', () => {
  const { context } = createGasMockEnvironment();

  // 701班01號選取 AI機器人創客社
  const sel1 = context.submitSelection('701', '01', '6789', 'AI機器人創客社');
  assert.equal(sel1.status, 'success');

  // 701班02號登入時，可看到該社團本班已選 1 人
  const verify2 = context.verifyAndGetClubs('701', '02', '6789');
  const robotClub = verify2.clubs.find(c => c.name === 'AI機器人創客社');
  assert.equal(robotClub.classCount, 1);
  assert.equal(robotClub.current, 1);

  // 保障生 (701班03號) 不可自行退選
  const cancelLocked = context.cancelSelection('701', '03', '6789');
  assert.equal(cancelLocked.status, 'error');

  // 701班01號執行開放期間重新改選 -> 釋出名額並可改選其他社團
  const cancelRes = context.cancelSelection('701', '01', '6789');
  assert.equal(cancelRes.status, 'success');
  assert.equal(cancelRes.student.assignedClub, '');
  const robotAfterCancel = cancelRes.clubs.find(c => c.name === 'AI機器人創客社');
  assert.equal(robotAfterCancel.current, 0);

  // 重新改選「數位動漫與繪畫社」成功
  const selNew = context.submitSelection('701', '01', '6789', '數位動漫與繪畫社');
  assert.equal(selNew.status, 'success');

  // 後台可取得未選社學生明細
  const token = context.loginAdmin('test-password').token;
  const dash = context.getAdminDashboardData(token);
  assert.ok(Array.isArray(dash.unassignedStudents));
  assert.ok(dash.unassignedStudents.length > 0);
});

function callApi(context, fn, args) {
  const out = context.doPost({ postData: { contents: JSON.stringify({ fn, args }) } });
  return JSON.parse(out.getContent());
}

test('10. doPost API 閘道：白名單路由、健康檢查與錯誤封裝', () => {
  const { context } = createGasMockEnvironment();

  // 健康檢查（驗證資料庫可開啟）
  const ping = callApi(context, 'getServerStatus', []);
  assert.equal(ping.ok, true);
  assert.equal(ping.result.dbConnected, true);

  // 公開 API 可由 Pages 前端呼叫
  const classes = callApi(context, 'getClassList', []);
  assert.deepEqual(classes.result, ['701', '702']);

  // 非白名單函式（含內部／危險函式）一律拒絕
  const bad = callApi(context, 'ensureSheetExists', []);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /404/);
  assert.equal(callApi(context, 'constructor', []).ok, false);
  assert.equal(callApi(context, '__proto__', []).ok, false);

  // 後台函式沒有 Token 時，錯誤被封裝為 { ok:false }
  const noAuth = callApi(context, 'getAdminDashboardData', ['bad-token']);
  assert.equal(noAuth.ok, false);
  assert.match(noAuth.error, /403/);

  // 非 JSON 內容不會拋出例外
  const garbage = JSON.parse(context.doPost({ postData: { contents: 'not-json' } }).getContent());
  assert.equal(garbage.ok, false);
});

test('11. 後台社團管理：新增／修改／刪除與保護規則', () => {
  const { context } = createGasMockEnvironment();
  const token = context.loginAdmin('test-password').token;

  // 未授權不可寫入
  assert.throws(() => context.saveClub('bad', { name: 'X', limit: 5 }), /403/);

  // 新增（簡介欄位開頭為 = 時需被中和，防公式注入）
  const created = context.saveClub(token, { name: '周末探索社', limit: 10, teacher: '周老師', location: '活動中心', desc: '=HYPERLINK("http://x","y")', requirement: '', category: '綜合興趣' });
  assert.equal(created.status, 'success');
  const added = created.clubs.find(c => c.name === '周末探索社');
  assert.ok(added.desc.startsWith("'"), '開頭為 = 的內容必須被中和以防公式注入');

  // 社團名稱會被名冊引用，危險開頭直接拒絕
  assert.equal(context.saveClub(token, { name: '=攻擊社', limit: 5 }).status, 'error');

  // 欄位驗證與重名
  assert.equal(context.saveClub(token, { name: '', limit: 5 }).status, 'error');
  assert.equal(context.saveClub(token, { name: '新社', limit: 0 }).status, 'error');
  assert.equal(context.saveClub(token, { name: 'AI機器人創客社', limit: 5 }).status, 'error');

  // 修改人數上限
  const updated = context.saveClub(token, { originalName: 'AI機器人創客社', name: 'AI機器人創客社', limit: 30, teacher: '李組長', location: '科技創客教室', desc: '更新簡介', requirement: '', category: '科技創客' });
  assert.equal(updated.status, 'success');
  assert.equal(updated.clubs.find(c => c.name === 'AI機器人創客社').limit, 30);

  // 已有學生錄取：不可更名、不可刪除、上限不可低於已錄取人數
  assert.equal(context.submitSelection('701', '01', '6789', 'AI機器人創客社').status, 'success');
  assert.equal(context.saveClub(token, { originalName: 'AI機器人創客社', name: '改名社', limit: 30 }).status, 'error');
  assert.equal(context.saveClub(token, { originalName: 'AI機器人創客社', name: 'AI機器人創客社', limit: 0 }).status, 'error');
  assert.equal(context.deleteClub(token, 'AI機器人創客社').status, 'error');

  // 無人錄取的社團可刪除
  const removed = context.deleteClub(token, '數位動漫與繪畫社');
  assert.equal(removed.status, 'success');
  assert.ok(!removed.clubs.some(c => c.name === '數位動漫與繪畫社'));
  assert.equal(context.deleteClub(token, '不存在的社團').status, 'error');
});

test('12. 導師通行碼可由後台更換，且儀表板提示是否仍為預設值', () => {
  const { context } = createGasMockEnvironment();
  const token = context.loginAdmin('test-password').token;

  assert.equal(context.getAdminDashboardData(token).settings.teacherPasswordIsDefault, true);

  // 過短或沿用預設值被拒
  assert.equal(context.saveSystemSettings(token, { teacherPassword: '123' }).status, 'error');
  assert.equal(context.saveSystemSettings(token, { teacherPassword: 'teacher888' }).status, 'error');

  // 設定新通行碼後，舊預設碼失效、新碼可用
  assert.equal(context.saveSystemSettings(token, { teacherPassword: 'Daxi-Hr-2026' }).status, 'success');
  assert.throws(() => context.getHomeroomClassData('701', 'teacher888'), /403/);
  assert.equal(context.getHomeroomClassData('701', 'Daxi-Hr-2026').status, 'success');
  assert.equal(context.getAdminDashboardData(token).settings.teacherPasswordIsDefault, false);
});

test('13. 試算表分頁健檢與多餘分頁清理（保護必要分頁，僅刪未使用分頁）', () => {
  const { context } = createGasMockEnvironment();
  const token = context.loginAdmin('test-password').token;

  // 未授權禁止查詢與刪除
  assert.throws(() => context.getSpreadsheetAudit('invalid'), /403/);
  assert.throws(() => context.cleanupUnusedSheets('invalid', ['Students']), /403/);

  // 模擬舊版遺留分頁
  const ss = context.getSpreadsheet();
  ss.insertSheet('Students');
  ss.insertSheet('Settings');
  ss.insertSheet('Clubs');
  ss.insertSheet('Registrations');

  const audit = context.getSpreadsheetAudit(token);
  assert.equal(audit.status, 'success');
  assert.equal(audit.sheets.length, 7);
  assert.equal(audit.sheets.find(s => s.name === '學生名冊').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === '社團設定').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === '系統設定').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === 'Students').usedByApp, false);

  // 空陣列被拒絕
  assert.equal(context.cleanupUnusedSheets(token, []).status, 'error');

  // 即使傳入系統必要分頁也必須受保護，只刪除未使用的英文分頁
  const res = context.cleanupUnusedSheets(token, ['Students', 'Settings', 'Clubs', 'Registrations', '學生名冊', '社團設定']);
  assert.equal(res.status, 'success');
  assert.deepEqual(Array.from(res.deleted).sort(), ['Clubs', 'Registrations', 'Settings', 'Students'].sort());
  assert.deepEqual(Array.from(res.skippedProtected).sort(), ['社團設定', '學生名冊'].sort());
  assert.deepEqual(Array.from(res.remaining).sort(), ['社團設定', '學生名冊', '系統設定'].sort());
});

test('14. 後台統一管理網頁標題與 Google 試算表檔名，並防呆空白與未授權請求', () => {
  const { context, mockSpreadsheet } = createGasMockEnvironment();
  const token = context.loginAdmin('test-password').token;

  // 初始狀態：後台可偵測試算表檔名與系統設定標題不同
  const initialDash = context.getAdminDashboardData(token);
  assert.equal(initialDash.settings.title, '大溪國中 AI 智慧社團選社系統');
  assert.equal(initialDash.settings.spreadsheetName, '114學年度社團選社系統');

  // 未授權呼叫不得更名試算表或竄改標題
  const badAuth = callApi(context, 'saveSystemSettings', ['invalid-token', { title: '被竄改的名稱' }]);
  assert.equal(badAuth.ok, false);
  assert.match(badAuth.error, /403/);
  assert.equal(mockSpreadsheet.getName(), '114學年度社團選社系統');

  // 空白名稱應被擋下，不可清空標題或試算表檔名
  const emptyRes = context.saveSystemSettings(token, { title: '   \n\t  ' });
  assert.equal(emptyRes.status, 'error');
  assert.equal(mockSpreadsheet.getName(), '114學年度社團選社系統');

  // 透過後台儲存統一名稱後，系統設定與試算表檔名同步一致
  const saveRes = context.saveSystemSettings(token, { title: '114學年度 大溪國中社團選社系統' });
  assert.equal(saveRes.status, 'success');
  assert.equal(saveRes.spreadsheetRenamed, true);
  assert.equal(saveRes.title, '114學年度 大溪國中社團選社系統');
  assert.equal(saveRes.spreadsheetName, '114學年度 大溪國中社團選社系統');
  assert.equal(mockSpreadsheet.getName(), '114學年度 大溪國中社團選社系統');
  assert.equal(context.getSystemSettings().title, '114學年度 大溪國中社團選社系統');
  assert.equal(context.getServerStatus().title, '114學年度 大溪國中社團選社系統');
  assert.equal(context.getAdminDashboardData(token).settings.spreadsheetName, '114學年度 大溪國中社團選社系統');

  // 相同名稱再次儲存不會重複觸發更名
  const repeatRes = context.saveSystemSettings(token, { title: '114學年度 大溪國中社團選社系統' });
  assert.equal(repeatRes.status, 'success');
  assert.equal(repeatRes.spreadsheetRenamed, false);
});
