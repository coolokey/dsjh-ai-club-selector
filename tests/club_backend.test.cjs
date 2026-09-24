const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createGasMockEnvironment() {
  const scriptProperties = new Map();
  scriptProperties.set('ADMIN_PASSWORD', 'admin888');

  // 模擬社團設定
  const clubRows = [
    ['社團名稱', '人數上限', '已錄取人數', '授課教師', '活動地點', '社團簡介', '先備要求與材料費'],
    ['AI機器人創客社', 15, 0, '李組長', '科技創客教室', '學習 Arduino 感測器、Micro:bit 與程式創作', '材料費 200 元'],
    ['熱血籃球戰術社', 2, 0, '陳教練', '風雨球場A', '基礎運球、團隊防守與分組對抗', '請自備球鞋'],
    ['數位動漫與繪畫社', 20, 0, '王老師', '電腦教室二', '電繪板基礎教學、角色骨架設計', '無基礎可']
  ];

  // 模擬學生名冊
  const studentRows = [
    ['班級', '座號', '姓名', '身分證字號', '第一志願', '第二志願', '第三志願', '錄取社團', '選填時間', '分發備註'],
    ['701', '01', '王大明', 'A123456789', '', '', '', '', '', ''],
    ['701', '02', '李小美', 'B223456789', '', '', '', '', '', ''],
    ['702', '01', '張志豪', 'C123456789', '', '', '', '', '', '']
  ];

  // 模擬系統設定
  const configRows = [
    ['設定項目', '設定值', '說明'],
    ['SYSTEM_TITLE', '大溪國中 AI 智慧社團選社系統', '系統標題'],
    ['SELECTION_MODE', 'instant', '選社模式'],
    ['OPEN_TIME', '', '開放時間'],
    ['CLOSE_TIME', '', '截止時間'],
    ['AI_ADVISOR_ENABLED', 'true', 'AI 顧問開關'],
    ['MAX_PREFERENCES', '3', '志願數量']
  ];

  function createMockSheet(name, rows) {
    return {
      getName: () => name,
      getDataRange: () => ({
        getValues: () => rows.map(r => r.slice())
      }),
      getRange: (row, col, numRows, numCols) => ({
        setValue: (val) => {
          if (numRows === undefined || numRows === 1) {
            rows[row - 1][col - 1] = val;
          }
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
    deleteSheet: (s) => {
      delete sheets[s.getName()];
    },
    getSheets: () => Object.values(sheets)
  };

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
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {}
      })
    },
    Utilities: {
      formatDate: (d, tz, fmt) => '2026-09-24 10:00:00'
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
                      { clubName: 'AI機器人創客社', matchScore: 95, reason: '極具適配性' }
                    ],
                    encouragement: '勇於嘗試！'
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

  return { context, sheets, scriptProperties };
}

test('1. 學生名冊與班級清單載入', () => {
  const { context } = createGasMockEnvironment();
  const classes = context.getClassList();
  assert.deepEqual(classes, ['701', '702']);

  const students701 = context.getStudentsByClass('701');
  assert.equal(students701.length, 2);
  assert.equal(students701[0].name, '王大明');
});

test('2. 學生身分驗證 (末4碼與全碼均支援)', () => {
  const { context } = createGasMockEnvironment();
  
  // 錯誤密碼
  const failed = context.verifyAndGetClubs('701', '01', '9999');
  assert.equal(failed.status, 'error');

  // 正確末4碼 6789
  const success4 = context.verifyAndGetClubs('701', '01', '6789');
  assert.equal(success4.status, 'success');
  assert.equal(success4.student.name, '王大明');
  assert.equal(success4.clubs.length, 3);
});

test('3. 即時選填報名與防超額防重複鎖定', () => {
  const { context } = createGasMockEnvironment();

  // 學生 1 報名籃球社 (上限 2 人)
  const res1 = context.submitSelection('701', '01', '6789', '熱血籃球戰術社');
  assert.equal(res1.status, 'success');

  // 學生 1 嘗試重複報名
  const resDup = context.submitSelection('701', '01', '6789', 'AI機器人創客社');
  assert.equal(resDup.status, 'error');
  assert.match(resDup.message, /先前已成功錄取/);

  // 學生 2 報名籃球社 (目前已 1 人，滿額為 2)
  const res2 = context.submitSelection('701', '02', '6789', '熱血籃球戰術社');
  assert.equal(res2.status, 'success');

  // 學生 3 (702班) 嘗試報名籃球社 (此時應已額滿)
  const resFull = context.submitSelection('702', '01', '6789', '熱血籃球戰術社');
  assert.equal(resFull.status, 'error');
  assert.match(resFull.message, /額滿/);
});

test('4. Gemini AI 智慧選社顧問與備援規則引擎', () => {
  const { context } = createGasMockEnvironment();

  // 測試關鍵字觸發
  const rec = context.aiConsultantRecommend('我喜歡研究寫程式還有自動化機器人', { className: '701' });
  assert.equal(rec.status, 'success');
  assert.ok(rec.data.recommendations.length > 0);
  assert.equal(rec.data.recommendations[0].clubName, 'AI機器人創客社');
});

test('5. 多志願序登記與智慧適性分發', () => {
  const { context } = createGasMockEnvironment();

  // 學生填寫志願
  const pRes = context.submitPreferences('701', '01', '6789', 'AI機器人創客社', '熱血籃球戰術社', '數位動漫與繪畫社');
  assert.equal(pRes.status, 'success');

  // 管理端執行分發
  const allocRes = context.runAiSmartAllocation();
  assert.equal(allocRes.status, 'success');
  assert.ok(allocRes.report.totalProcessed > 0);
  assert.ok(allocRes.report.satisfactionRate >= 0);
});

test('6. 教師管理後台密碼與一鍵行政報表', () => {
  const { context } = createGasMockEnvironment();

  // 登入
  const loginRes = context.loginAdmin('admin888');
  assert.equal(loginRes.status, 'success');
  assert.equal(loginRes.isDefault, true);

  // 點名單匯出
  const attRes = context.exportAttendanceSheets();
  assert.equal(attRes.status, 'success');

  // Docs 成果手冊匯出
  const docRes = context.generateClubDocManual();
  assert.equal(docRes.status, 'success');
  assert.ok(docRes.docUrl);
});
