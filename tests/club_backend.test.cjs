const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createGasMockEnvironment(options) {
  const opts = options || {};
  const scriptProperties = new Map();
  scriptProperties.set('ADMIN_PASSWORD', 'test-password');
  scriptProperties.set('SCORE_SYNC_V', '1');
  scriptProperties.set('ADMIN_SHEET_SYNC_V', '20261113_admin888');

  const cacheStore = new Map();

  // 模擬社團設定 (社團名稱, 人數上限, 已錄取人數, 授課教師, 活動地點, 社團簡介, 先備要求, 類別)
  const clubRows = [
    ['社團名稱', '人數上限', '已錄取人數', '授課教師', '活動地點', '社團簡介', '先備要求與材料費', '社團類別'],
    ['AI機器人創客社', 15, 0, '李組長', '科技創客教室', '學習 Arduino 感測器、Micro:bit 與程式創作', '材料費 200 元', '科技創客'],
    ['熱血籃球戰術社', 2, 0, '陳教練', '風雨球場A', '基礎運球、團隊防守與分組對抗', '自備球鞋', '體育競技'],
    ['數位動漫與繪畫社', 20, 0, '王老師', '電腦教室二', '電繪板基礎教學、角色骨架設計', '無基礎可', '視覺藝術']
  ];

  // 模擬學生名單 (對齊成績查詢系統 7 欄 + 選社專用 9 欄)
  const studentRows = [
    [
      '學號', '姓名', '班級', '座號', '身分證後四碼', '出生月日', '密碼',
      '學生Email', '第一志願', '第二志願', '第三志願', '錄取社團', '選填時間',
      '分發備註', '保障身分鎖定', '健康安全提醒'
    ],
    ['11470101', '王大明', '701', '01', '6789', '0101', '67890101', 'daxi_70101@example.com', '', '', '', '', '', '', '', ''],
    ['11470102', '李小美', '701', '02', '6789', '0202', '67890202', 'daxi_70102@example.com', '', '', '', '', '', '', '', ''],
    ['11470103', '張志豪', '701', '03', '6789', '0303', '67890303', 'daxi_70103@example.com', '', '', '', '', '', '', '校隊保障(籃球)', ''],
    ['11470201', '陳建宏', '702', '01', '6789', '0404', '67890404', 'daxi_70201@example.com', '', '', '', '', '', '', '', '氣喘，劇烈運動注意']
  ];

  // 模擬導師名單 (比照成績查詢系統)
  const teacherRows = [
    ['教師帳號', '教師姓名', '負責班級', '密碼', '首次登入標記', '公務信箱'],
    ['tf51056', '張雅琪 導師', '7年1班', '701701', true, 'tf51056@dsjh.tyc.edu.tw'],
    ['tf51032', '李俊毅 導師', '7年2班', '702702', false, 'tf51032@dsjh.tyc.edu.tw']
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

  function createMockSheet(name, rows, readOnlyGuard) {
    const layoutState = {
      colWidths: {},
      wrapCalls: [],
      verticalAlignments: [],
      frozenRows: 0,
      autoResized: false
    };
    const assertWritable = () => {
      if (readOnlyGuard) throw new Error('FORBIDDEN WRITE ON READ-ONLY SOURCE SPREADSHEET');
    };
    const getLastColCount = () => rows.reduce((m, r) => Math.max(m, r.length), 0);
    return {
      _layout: layoutState,
      getName: () => name,
      getLastRow: () => rows.length,
      getLastColumn: () => getLastColCount(),
      getMaxRows: () => Math.max(rows.length + 10, 50),
      getMaxColumns: () => Math.max(getLastColCount() + 2, 16),
      getDataRange: () => ({
        getValues: () => rows.map(r => r.slice()),
        getDisplayValues: () => rows.map(r => r.map(c => (c === undefined || c === null ? '' : String(c))))
      }),
      getRange: (row, col, numRows, numCols) => ({
        getValues: () => {
          const out = [];
          const rCount = numRows || 1;
          const cCount = numCols || 1;
          for (let r = 0; r < rCount; r++) {
            const src = rows[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < cCount; c++) {
              line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            }
            out.push(line);
          }
          return out;
        },
        setValue: (val) => {
          assertWritable();
          const rowIndex = row - 1;
          const colIndex = col - 1;
          if (!rows[rowIndex]) rows[rowIndex] = [];
          rows[rowIndex][colIndex] = val;
        },
        setValues: (vals) => {
          assertWritable();
          for (let r = 0; r < vals.length; r++) {
            const rowIndex = row - 1 + r;
            if (!rows[rowIndex]) rows[rowIndex] = [];
            for (let c = 0; c < vals[r].length; c++) {
              rows[rowIndex][col - 1 + c] = vals[r][c];
            }
          }
        },
        setNumberFormat: function() { assertWritable(); return this; },
        setWrap: function(flag) {
          assertWritable();
          layoutState.wrapCalls.push({ row, col, numRows: numRows || 1, numCols: numCols || 1, wrap: !!flag });
          return this;
        },
        setVerticalAlignment: function(align) {
          assertWritable();
          layoutState.verticalAlignments.push(align);
          return this;
        },
        setBackground: function() { assertWritable(); return this; },
        setFontColor: function() { assertWritable(); return this; },
        setFontWeight: function() { assertWritable(); return this; },
        setFontSize: function() { assertWritable(); return this; },
        setHorizontalAlignment: function() { assertWritable(); return this; },
        merge: function() { assertWritable(); return this; }
      }),
      setColumnWidth: (colIdx, width) => { assertWritable(); layoutState.colWidths[colIdx] = width; },
      setColumnWidths: (startCol, count, width) => {
        assertWritable();
        for (let i = 0; i < count; i++) layoutState.colWidths[startCol + i] = width;
      },
      setFrozenRows: (n) => { assertWritable(); layoutState.frozenRows = n; },
      autoResizeRows: () => { assertWritable(); layoutState.autoResized = true; },
      appendRow: (row) => { assertWritable(); rows.push(row.slice()); },
      deleteRow: (n) => { assertWritable(); rows.splice(n - 1, 1); },
      clearContents: () => { assertWritable(); rows.length = 0; },
      clear: () => { assertWritable(); rows.length = 0; },
      getSheetId: () => 101
    };
  }

  const sheets = {
    '社團設定': createMockSheet('社團設定', clubRows),
    '學生名單': createMockSheet('學生名單', studentRows),
    '導師名單': createMockSheet('導師名單', teacherRows),
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

  let mockScoreSpreadsheet = null;
  if (opts.scoreSource) {
    const roSheets = {};
    Object.keys(opts.scoreSource).forEach(sName => {
      roSheets[sName] = createMockSheet(sName, opts.scoreSource[sName], true);
    });
    mockScoreSpreadsheet = {
      getId: () => '1cLrFMTA-gXTDQFKzW2E1C186_WJ0SuwMhky1_RL2Q3U',
      getSheetByName: (name) => roSheets[name] || null
    };
  }

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
      openById: (id) => (mockScoreSpreadsheet && id === '1cLrFMTA-gXTDQFKzW2E1C186_WJ0SuwMhky1_RL2Q3U')
        ? mockScoreSpreadsheet
        : mockSpreadsheet,
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
        put: (k, v) => cacheStore.set(k, String(v)),
        remove: (k) => cacheStore.delete(k)
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
      getUuid: () => 'mock-uuid-' + Math.random().toString(36).substring(2, 9),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(String(text), 'utf8').digest())
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

test('1. 班級清單載入與未登入不可列舉班級學生名單', () => {
  const { context } = createGasMockEnvironment();
  const classes = context.getClassList();
  assert.deepEqual(classes, ['701', '702']);

  // 已移除未授權的班級座號姓名列舉 API（防學生姓名資訊外洩）
  const enumRes = callApi(context, 'getStudentsByClass', ['701']);
  assert.equal(enumRes.ok, false);
  assert.match(enumRes.error, /404/);
});

test('2. 學生學號密碼驗證、免自行改密功能與連續錯誤鎖定', () => {
  const { context } = createGasMockEnvironment();

  // 正確學號與預設密碼（支援身分證末4碼+出生月日，取得 studentToken）
  const res1 = context.verifyAndGetClubs('11470101', '67890101');
  assert.equal(res1.status, 'success');
  assert.ok(res1.token);
  assert.equal(res1.student.name, '王大明');
  assert.equal(res1.student.email, 'daxi_70101@example.com');
  assert.equal(res1.student.className, '701');
  assert.equal(res1.student.seat, '01');

  // 學生密碼不開放線上自行變更，由教務處註冊組統一管理
  const chg = context.changeStudentPassword(res1.token, '67890101', 'DaxiStu!99');
  assert.equal(chg.status, 'error');
  assert.match(chg.message, /教務處註冊組/);

  // 身分保障學生 (701班03號 11470103)
  const resLocked = context.verifyAndGetClubs('11470103', '67890303');
  assert.equal(resLocked.status, 'success');
  assert.equal(resLocked.student.lockedClub, '校隊保障(籃球)');

  // 連續錯誤 5 次後帳號鎖定 15 分鐘（第 6 次即使輸入正確密碼仍被鎖定阻擋）
  for (let i = 0; i < 5; i++) {
    const bad = context.verifyAndGetClubs('11470102', 'wrong-pwd');
    assert.equal(bad.status, 'error');
  }
  const lockedOut = context.verifyAndGetClubs('11470102', '67890202');
  assert.equal(lockedOut.status, 'error');
  assert.match(lockedOut.message, /鎖定/);
});

test('3. 即時選填、Email 錄取通知發送與班級防抱團限制', () => {
  const { context, sentEmails } = createGasMockEnvironment();

  const stu1Token = context.verifyAndGetClubs('11470101', '67890101').token;
  const stu2Token = context.verifyAndGetClubs('11470102', '67890202').token;

  // 學生 1 (701班) 報名籃球社
  const res1 = context.submitSelection(stu1Token, '熱血籃球戰術社');
  assert.equal(res1.status, 'success');
  assert.equal(res1.emailSent, true);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].subject, /錄取通知函/);

  // 學生 1 再次送出相同社團 -> 等冪性回傳成功
  const resDupSame = context.submitSelection(stu1Token, '熱血籃球戰術社');
  assert.equal(resDupSame.status, 'success');
  assert.equal(resDupSame.isDuplicateConfirm, true);

  // 學生 2 (701班) 報名籃球社 (達到 MAX_PER_CLASS_PER_CLUB=2 的限制)
  const res2 = context.submitSelection(stu2Token, '熱血籃球戰術社');
  assert.equal(res2.status, 'success');

  // 學生 1 嘗試改報他社 -> 已錄取不可重複選填
  const resBlock = context.submitSelection(stu1Token, 'AI機器人創客社');
  assert.equal(resBlock.status, 'error');
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

  // 學生以 Token 填寫志願
  const stuToken = context.verifyAndGetClubs('11470101', '67890101').token;
  const prefRes = context.submitPreferences(stuToken, 'AI機器人創客社', '熱血籃球戰術社', '數位動漫與繪畫社');
  assert.equal(prefRes.status, 'success');

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

test('6. 導師帳號登入、首次強制改密、跨班權限隔離與點名冊', () => {
  const { context, sheets } = createGasMockEnvironment();
  const adminToken = context.loginAdmin('test-password').token;

  // 未登入或無效 Token 禁止存取導師專區
  assert.throws(() => context.getHomeroomClassData('701'), /403/);
  assert.throws(() => context.getHomeroomClassData('701', 'invalid'), /403/);

  // 管理員可查核任何班級
  const adminHrData = context.getHomeroomClassData('701', adminToken);
  assert.equal(adminHrData.status, 'success');
  assert.equal(adminHrData.className, '701');
  assert.ok(adminHrData.noticeText.includes('701 班社團選社進度通知'));

  // 導師 tf51056（首次登入標記 true）登入成功並回傳 mustChangePassword=true
  const tLogin = context.loginTeacher('TF51056', '701701');
  assert.equal(tLogin.status, 'success');
  assert.equal(tLogin.teacher.assignedClass, '701');
  assert.equal(tLogin.teacher.mustChangePassword, true);

  // 尚未改密前不可查詢班級資料
  assert.throws(() => context.getHomeroomClassData('701', tLogin.token), /PasswordChangeRequired/);

  // 導師變更密碼（至少 6 碼且不可同原密碼）
  assert.equal(context.changeTeacherPassword(tLogin.token, '701701', '701701').status, 'error');
  assert.equal(context.changeTeacherPassword(tLogin.token, '701701', '12345').status, 'error');
  const tChg = context.changeTeacherPassword(tLogin.token, '701701', 'DaxiTch#2026');
  assert.equal(tChg.status, 'success');
  assert.ok(String(sheets['導師名單'].getDataRange().getValues()[1][3]).startsWith('sha256$'));
  assert.equal(sheets['導師名單'].getDataRange().getValues()[1][4], false);

  // 改密後：僅能查詢負責班級 701，跨班查詢 702 必拋 403
  const hrTeacherData = context.getHomeroomClassData('701', tLogin.token);
  assert.equal(hrTeacherData.status, 'success');
  assert.equal(hrTeacherData.className, '701');
  assert.throws(() => context.getHomeroomClassData('702', tLogin.token), /403/);

  // 下次使用新密碼登入，mustChangePassword 為 false
  const tReLogin = context.loginTeacher('tf51056', 'DaxiTch#2026');
  assert.equal(tReLogin.status, 'success');
  assert.equal(tReLogin.teacher.mustChangePassword, false);

  // 產出點名冊
  const attRes = context.exportAttendanceSheets(adminToken);
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
  sheets['學生名單'].getRange(2, 9).setValue('熱血籃球戰術社');
  assert.equal(context.runAiSmartAllocation(token, preview.previewToken).status, 'error');
});

test('Recorded draw order is the allocation order and capacities remain enforced', () => {
  const { context, sheets } = createGasMockEnvironment();
  sheets['社團設定'].getRange(1, 1).setValues([
    ['社團名稱', '人數上限', '已錄取人數'], ['唯一社團', 1, 0]
  ]);
  for (let row = 2; row <= 5; row++) sheets['學生名單'].getRange(row, 9).setValue('唯一社團');
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
  const stu1Token = context.verifyAndGetClubs('11470101', '67890101').token;

  // 701班01號選取 AI機器人創客社
  const sel1 = context.submitSelection(stu1Token, 'AI機器人創客社');
  assert.equal(sel1.status, 'success');

  // 701班02號登入時，可看到該社團本班已選 1 人
  const verify2 = context.verifyAndGetClubs('11470102', '67890202');
  const robotClub = verify2.clubs.find(c => c.name === 'AI機器人創客社');
  assert.equal(robotClub.classCount, 1);
  assert.equal(robotClub.current, 1);

  // 保障生 (701班03號) 不可自行退選
  const stu3Token = context.verifyAndGetClubs('11470103', '67890303').token;
  const cancelLocked = context.cancelSelection(stu3Token);
  assert.equal(cancelLocked.status, 'error');

  // 701班01號執行開放期間重新改選 -> 釋出名額並可改選其他社團
  const cancelRes = context.cancelSelection(stu1Token);
  assert.equal(cancelRes.status, 'success');
  assert.equal(cancelRes.student.assignedClub, '');
  const robotAfterCancel = cancelRes.clubs.find(c => c.name === 'AI機器人創客社');
  assert.equal(robotAfterCancel.current, 0);

  // 重新改選「數位動漫與繪畫社」成功
  const selNew = context.submitSelection(stu1Token, '數位動漫與繪畫社');
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
  const stu1Token = context.verifyAndGetClubs('11470101', '67890101').token;
  assert.equal(context.submitSelection(stu1Token, 'AI機器人創客社').status, 'success');
  assert.equal(context.saveClub(token, { originalName: 'AI機器人創客社', name: '改名社', limit: 30 }).status, 'error');
  assert.equal(context.saveClub(token, { originalName: 'AI機器人創客社', name: 'AI機器人創客社', limit: 0 }).status, 'error');
  assert.equal(context.deleteClub(token, 'AI機器人創客社').status, 'error');

  // 無人錄取的社團可刪除
  const removed = context.deleteClub(token, '數位動漫與繪畫社');
  assert.equal(removed.status, 'success');
  assert.ok(!removed.clubs.some(c => c.name === '數位動漫與繪畫社'));
  assert.equal(context.deleteClub(token, '不存在的社團').status, 'error');
});

test('12. 學生預設密碼無密碼欄回退 (身分證後4碼+出生月日) 與導師 5 次錯誤鎖定', () => {
  const { context, sheets } = createGasMockEnvironment();
  // 清空第 1 位學生第 7 欄（密碼）-> 應自動回退比對 身分證後4碼 + 出生月日 (67890101)
  sheets['學生名單'].getRange(2, 7).setValue('');
  const fallbackLogin = context.verifyAndGetClubs('11470101', '67890101');
  assert.equal(fallbackLogin.status, 'success');

  // 導師連續錯誤 5 次後鎖定 15 分鐘
  for (let i = 0; i < 5; i++) {
    assert.equal(context.loginTeacher('tf51032', 'wrong').status, 'error');
  }
  const lockedTeacher = context.loginTeacher('tf51032', '702702');
  assert.equal(lockedTeacher.status, 'error');
  assert.match(lockedTeacher.message, /鎖定/);
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
  assert.equal(audit.sheets.length, 9);
  assert.equal(audit.sheets.find(s => s.name === '學生名單').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === '導師名單').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === '管理者名單').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === '社團設定').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === '系統設定').usedByApp, true);
  assert.equal(audit.sheets.find(s => s.name === 'Students').usedByApp, false);

  // 空陣列被拒絕
  assert.equal(context.cleanupUnusedSheets(token, []).status, 'error');

  // 即使傳入系統必要分頁也必須受保護，只刪除未使用的英文分頁
  const res = context.cleanupUnusedSheets(token, ['Students', 'Settings', 'Clubs', 'Registrations', '學生名單', '社團設定', '導師名單']);
  assert.equal(res.status, 'success');
  assert.deepEqual(Array.from(res.deleted).sort(), ['Clubs', 'Registrations', 'Settings', 'Students'].sort());
  assert.deepEqual(Array.from(res.skippedProtected).sort(), ['導師名單', '社團設定', '學生名單'].sort());
  assert.deepEqual(Array.from(res.remaining).sort(), ['導師名單', '社團設定', '學生名單', '管理者名單', '系統設定'].sort());
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

test('15. 試算表每一分頁每一欄皆套用適當欄寬與自動換列（含點名簽到冊與導師名單）', () => {
  const { context, sheets } = createGasMockEnvironment();
  const token = context.loginAdmin('test-password').token;

  // 未授權不得調整排版
  const noAuth = callApi(context, 'formatAllSheetsLayout', ['bad-token']);
  assert.equal(noAuth.ok, false);
  assert.match(noAuth.error, /403/);

  // 產出點名簽到冊並驗證所有列皆為 11 欄且自動排版
  const attRes = context.exportAttendanceSheets(token);
  assert.equal(attRes.status, 'success');
  const attSheet = sheets['社團點名簽到冊'];
  assert.ok(attSheet);
  const attRows = attSheet.getDataRange().getValues();
  assert.ok(attRows.every(r => r.length === 11), '點名冊每一列應對齊 11 欄');

  // 執行全分頁一鍵欄寬與自動換列
  const res = context.formatAllSheetsLayout(token);
  assert.equal(res.status, 'success');
  assert.equal(res.sheets.length, 6);

  // 逐分頁檢查：所有欄都有正數寬度、整頁啟用 setWrap(true)、長文字欄位受限寬度以便換列
  Object.keys(sheets).forEach(name => {
    const s = sheets[name];
    const lastCol = s.getLastColumn();
    const wrapCall = s._layout.wrapCalls.find(w => w.row === 1 && w.col === 1 && w.numCols === s.getMaxColumns() && w.wrap === true);
    assert.ok(wrapCall, `${name} 必須全表（全部欄位與列）啟用自動換列 setWrap(true)`);
    for (let c = 1; c <= lastCol; c++) {
      const w = s._layout.colWidths[c];
      assert.ok(w >= 78 && w <= 360, `${name} 第 ${c} 欄寬 ${w}px 應在合理範圍`);
    }
  });

  // 檢查社團設定：第 6 欄（社團簡介）比第 2 欄（人數上限）寬，且不超過 360px 讓自動換列發揮作用
  const clubWidths = sheets['社團設定']._layout.colWidths;
  assert.ok(clubWidths[6] > clubWidths[2]);
  assert.ok(clubWidths[6] <= 360);
  assert.equal(sheets['社團設定']._layout.frozenRows, 1);

  // 檢查點名簽到冊：凍結前 3 列標題／表頭，第 11 欄簽到格不被 Row 2 緊通報字撐爆
  assert.equal(attSheet._layout.frozenRows, 3);
  assert.ok(attSheet._layout.colWidths[11] <= 120);
});

test('16. 從成績查詢系統唯讀複製學生與導師名單（不動來源試算表、保留前置0與選社成果/新密碼）', () => {
  const scoreSource = {
    '學生名單': [
      ['學號', '姓名', '班級', '座號', '身分證後四碼', '出生月日', '密碼'],
      ['1130001', '陳小明', '701', '01', '4567', '0105', 'sha256$fromscorehash'],
      ['1130002', '林小華', '701', '02', '8901', '0912', '']
    ],
    '導師名單': [
      ['教師帳號', '教師姓名', '負責班級', '密碼', '首次登入標記', '公務信箱'],
      ['tf90001', '周導師', '7年1班', '701701', 'TRUE', 'tf90001@dsjh.tyc.edu.tw'],
      ['tf90002', '吳導師', '7年2班', '702702', 'FALSE', 'tf90002@dsjh.tyc.edu.tw']
    ]
  };
  const { context, sheets } = createGasMockEnvironment({ scoreSource });
  const token = context.loginAdmin('test-password').token;

  // 未授權不得觸發同步
  assert.throws(() => context.syncUsersFromScoreSystem('bad-token'), /403/);

  // 預先模擬社團系統舊版遺留「學生名冊」，已有學生「1130002」的選社與密碼
  const legacy = context.getSpreadsheet().insertSheet('學生名冊');
  legacy.appendRow([
    '班級', '座號', '姓名', '身分證字號', '學生Email',
    '第一志願', '第二志願', '第三志願', '錄取社團', '選填時間',
    '分發備註', '保障身分鎖定', '健康安全提醒', '學號', '出生月日', '登入密碼'
  ]);
  legacy.appendRow([
    '701', '02', '林小華', '8901', 'lin@example.com',
    'AI機器人創客社', '', '', 'AI機器人創客社', '2026-09-27 10:00:00',
    '即時選填成功', '', '', '1130002', '0912', 'sha256$localchanged'
  ]);

  // 執行同步：若程式碼有任何試圖寫入來源試算表，readOnlyGuard 會直接拋錯失敗
  const syncRes = context.syncUsersFromScoreSystem(token);
  assert.equal(syncRes.status, 'success');
  assert.equal(syncRes.studentsCount, 2);
  assert.equal(syncRes.teachersCount, 2);
  assert.equal(syncRes.preservedSelections, 1);

  // 舊「學生名冊」分頁必須被徹底刪除
  assert.equal(sheets['學生名冊'], undefined, '舊學生名冊分頁應在同步後被刪除');

  const copiedStudents = sheets['學生名單'].getDataRange().getValues();
  // Demo 假學生已被取代清理，剩標頭 + 2 名真實學生
  assert.equal(copiedStudents.length, 3);
  assert.equal(copiedStudents[1][0], '1130001'); // 學號在第 1 欄 (0-based)
  assert.equal(copiedStudents[1][1], '陳小明'); // 姓名
  assert.equal(copiedStudents[1][4], '4567'); // 身分證後四碼
  assert.equal(copiedStudents[1][5], '0105'); // 出生月日 前置 0 完整保留
  assert.equal(copiedStudents[1][6], 'sha256$fromscorehash'); // 密碼 沿用成績系統雜湊密碼
  // 既有選社成果與社團內已修改的新密碼均被保留
  assert.equal(copiedStudents[2][0], '1130002');
  assert.equal(copiedStudents[2][6], 'sha256$localchanged');
  assert.equal(copiedStudents[2][11], 'AI機器人創客社'); // 錄取社團在第 12 欄 (col index 11)

  // 驗證新複製過來的學生「1130002」無法用預設密碼，可用空白欄位回退或本地密碼；驗證新導師 tf90001 可用預設密碼登入並觸發首次改密
  const tLogin = context.loginTeacher('tf90001', '701701');
  assert.equal(tLogin.status, 'success');
  assert.equal(tLogin.teacher.mustChangePassword, true);
  assert.equal(tLogin.teacher.assignedClass, '701');
});

test('17. 管理者密碼存於試算表（管理者名單與系統設定）：手動改試算表、後台改密碼同步雙向生效，且保護分頁不被刪除', () => {
  const { context, sheets } = createGasMockEnvironment();

  // (1) 確保「管理者名單」工作表已自動建立，且內含 admin 帳號與密碼
  context.ensureSheetExists();
  assert.ok(sheets['管理者名單'], '管理者名單工作表必須存在');
  const adminValues = sheets['管理者名單'].getDataRange().getValues();
  assert.equal(adminValues[0][0], '帳號');
  assert.equal(adminValues[0][2], '密碼');
  assert.equal(adminValues[1][0], 'admin');

  // (2) 學校承辦人直接在試算表 C2 格修改密碼為「sheetAdmin#888」
  sheets['管理者名單'].getRange(2, 3).setValue('sheetAdmin#888');

  // 網站後台立即能以「sheetAdmin#888」登入成功
  const loginRes = context.loginAdmin('sheetAdmin#888');
  assert.equal(loginRes.status, 'success');
  assert.equal(loginRes.isDefault, false);
  const token = loginRes.token;

  // 錯誤密碼遭拒
  assert.equal(context.loginAdmin('wrongpwd').status, 'error');

  // (3) 管理者於網站後台變更密碼為「newCloudPass#999」
  const changeRes = context.changeAdminPassword(token, 'sheetAdmin#888', 'newCloudPass#999');
  assert.equal(changeRes.status, 'success');

  // 驗證「管理者名單」與「系統設定」試算表格位皆已同步寫入新密碼
  const updatedAdminRows = sheets['管理者名單'].getDataRange().getValues();
  assert.equal(updatedAdminRows[1][2], 'newCloudPass#999');

  const cfgRows = sheets['系統設定'].getDataRange().getValues();
  const cfgPwdRow = cfgRows.find(r => r[0] === 'ADMIN_PASSWORD');
  assert.ok(cfgPwdRow, '系統設定中必須有 ADMIN_PASSWORD');
  assert.equal(cfgPwdRow[1], 'newCloudPass#999');

  // (4) 健檢分頁清單：管理者名單必須受系統保護 (usedByApp = true)，不可被清理
  const audit = context.getSpreadsheetAudit(token);
  const adminAudit = audit.sheets.find(s => s.name === '管理者名單');
  assert.ok(adminAudit, '健檢報告必須包含管理者名單');
  assert.equal(adminAudit.usedByApp, true, '管理者名單必須被標記為 usedByApp');

  const cleanRes = context.cleanupUnusedSheets(token, ['管理者名單']);
  assert.equal(cleanRes.deleted.includes('管理者名單'), false, '受保護分頁不可被刪除');
});

test('18. 跨校 28 所多元熱門社團（涵蓋體能、創客、藝術、音樂、邏輯、服務六大領域）：初始化自動擴充、一鍵重設與公開社團總覽 API', () => {
  const { context, sheets } = createGasMockEnvironment();
  const token = context.loginAdmin('test-password').token;

  // (1) 一鍵匯入 28 所多元熱門社團
  const seedRes = context.seedCanonicalClubs(token, true);
  assert.equal(seedRes.status, 'success');
  assert.ok(seedRes.clubs.length >= 28, '社團數量需至少 28 所');

  // 驗證六大主要領域皆有涵蓋
  const categories = new Set(seedRes.clubs.map(c => c.category));
  assert.ok(categories.has('體育競技'), '需包含體育競技');
  assert.ok(categories.has('科技創客'), '需包含科技創客');
  assert.ok(categories.has('視覺藝術'), '需包含視覺藝術');
  assert.ok(categories.has('音樂表演'), '需包含音樂表演');
  assert.ok(categories.has('策略邏輯'), '需包含策略邏輯');
  assert.ok(categories.has('自然實驗'), '需包含自然實驗');

  // 驗證總名額充分支援全校 30 班約 720 人規模
  const totalCapacity = seedRes.clubs.reduce((sum, c) => sum + c.limit, 0);
  assert.ok(totalCapacity >= 650, `總名額應足夠（目前 ${totalCapacity} 席）`);

  // (2) 公開社團目錄 API：免登入即可預覽全校社團
  const pubCatalog = context.getPublicClubCatalog();
  assert.equal(pubCatalog.status, 'success');
  assert.equal(pubCatalog.totalClubs, seedRes.clubs.length);

  // (3) doPost 路由白名單檢查
  const postPub = JSON.parse(context.doPost({
    postData: { contents: JSON.stringify({ fn: 'getPublicClubCatalog', args: [] }) }
  }).getContent());
  assert.equal(postPub.ok, true);
  assert.equal(postPub.result.totalClubs, seedRes.clubs.length);
});

