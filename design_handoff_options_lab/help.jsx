// help.jsx — layered in-app help (⑧), Traditional Chinese, desktop only.
//  ⑧a HelpTip  : a hover tooltip on individual metrics (the layer that matters most).
//  ⑧b HelpDrawer: a per-workspace glossary / tutorial behind the top-bar "?" chip.
// Copy lives in HELP_COPY so the tooltip and the drawer stay consistent.
// No top-level React hook destructure here — classic scripts share one global
// scope, so we call React.useState / React.useRef inline to avoid clashing with
// the aliases declared in the other .jsx files.

// Copy for every metric, in Traditional Chinese (the owner's language,
// 2026-11). Concrete numbers beat definitions.
const HELP_COPY = {
  delta:  { term: 'Delta (Δ)', short: '標的每漲 1 點，部位大約賺賠幾點。', example: 'Δ +0.50 → 標的 +1 點，部位約 +0.5 點' },
  gamma:  { term: 'Gamma (Γ)', short: 'Delta 本身變化的速度。Gamma 高 = 價格一動，Delta 就變很快。', example: 'Γ 0.010 → 標的每動 1 點，Delta 變 0.01' },
  theta:  { term: 'Theta (Θ)', short: '時間價值：其他都不變時，每過一天部位少（或多）多少。買方為負、賣方為正。', example: 'Θ −1.2 → 每天約少 1.2 點價值' },
  vega:   { term: 'Vega (V)', short: '隱含波動率每變 1 個百分點，部位價值變多少。', example: 'V +2.0 → IV 從 24% 升到 25%，部位 +2 點' },
  rho:    { term: 'Rho (ρ)', short: '利率每變 1%，部位價值變多少（影響很小）。', example: 'ρ +0.3 → 利率升 1%，部位 +0.3 點' },
  pop:    { term: '獲利機率', short: '模型估計到期時部位落在損益兩平以上的機率。', example: '77% → 約 77% 的情境會賺錢' },
  maxpain:{ term: '最大痛苦點', short: '結算在這個價格時，選擇權買方整體賠最多（最多合約歸零）。' },
  oi:     { term: '未平倉量', short: '這個履約價目前還沒平倉的口數。越多 = 越多人在這裡押注。' },
  vol:    { term: '成交量', short: '這個履約價今天已經成交的口數。' },
  iv:     { term: '隱含波動率 (IV)', short: '從權利金反推出來、市場預期的波動程度。IV 越高，選擇權越貴。' },
  hv:     { term: 'IV 對 歷史波動率', short: 'HV = 標的過去 20 天實際波動（年化）。IV 高於 HV：選擇權比實際波動貴（適合賣方）；低於 HV：便宜（適合買方）。', example: 'IV 24% · HV 18% → ×1.33，權利金偏貴' },
  dte:    { term: '剩餘天數', short: '距離到期還有幾天。越接近到期，時間價值流失越快。' },
  breakeven: { term: '損益兩平', short: '到期時部位剛好不賺不賠的標的價格。' },
  maxprofit: { term: '最大獲利', short: '部位在最近到期日能達到的最好結果（已扣估計手續費）。' },
  maxloss:{ term: '最大虧損', short: '部位在最近到期日最壞的結果（已扣估計手續費）。' },
  theoprice: { term: '理論價', short: '依現價、履約價、IV、剩餘天數算出來的合理價格。' },
  pnlnow: { term: '目前損益', short: '依選定時間點重新估值的部位損益，已扣估計手續費。' },
  pnlwhatif: { term: '模擬損益', short: '用右下角「模擬情境」的價格和 IV 重新估值的損益。' },
  payoff: { term: '到期損益圖', short: '不同標的價格下的損益。紫色區域是 IV 推算的 ±1σ / ±2σ 預期波動範圍。' },
  greeksprofile: { term: '希臘值變化', short: '標的價格移動時，Δ Γ Θ V 怎麼跟著變 —— 看離現價遠的地方風險有多大。' },
  pnldist:{ term: '損益分布', short: '依機率加權的到期結果：紅色 = 獲利、綠色 = 虧損。' },
  pricer: { term: '理論價試算', short: '單一履約價的合理價格和希臘值。IV 取自報價表，現價和天數取自市場。' },
  ivsurface: { term: 'IV 曲面', short: '每個履約價、每個到期日的隱含波動率。偏斜（skew）顯示市場在哪一側定價更多風險。' },
  straddle: { term: '價平和', short: '價平買權 + 價平賣權的權利金。兩者相加抵銷方向，剩下的就是市場預期到結算前會動幾點；價平 ± 價平和 = 預期區間。', example: '價平 46,150 · 買權 131 + 賣權 158 = 289 點 → 45,861–46,439' },
  resistance: { term: '壓力（Call 未平倉最大）', short: '買權未平倉最多的履約價。賣出買權的人不認為會漲過這裡；和前一天比的增減，看這道牆還在不在加高。' },
  support: { term: '支撐（Put 未平倉最大）', short: '賣權未平倉最多的履約價。賣出賣權的人不認為會跌破這裡。' },
  pcratio: { term: 'P/C 未平倉比', short: '賣權未平倉 ÷ 買權未平倉（期交所全市場、所有到期日）。大於 1 = 賣權較多；小於 1 = 買權較多。' },
  oichg: { term: '未平倉增減', short: '今天的未平倉減前一交易日。紅 = 新增部位、綠 = 平倉。正在變厚的牆比不動的牆重要。' },
  foreign: { term: '外資期貨淨部位', short: '外資在台指期（大台 + 小台÷4 + 微台÷20，換算成大台口數）的多單減空單。負數 = 淨空單。期交所收盤後公布。' },
  gex: { term: 'Gamma 曝險 (GEX)', short: '造市商在每個履約價的 Gamma：γ × 未平倉 × 乘數 × 現價² × 1%，買權算正、賣權算負。總 GEX 為正：造市商避險會壓抑波動；為負：避險會追價、放大波動。零 Gamma = 總 GEX 由正轉負的價位。', example: '價平 γ 0.0004 × 3,000 口 × 50 × 46,000² × 1% ≈ 每 1% 波動 12.7 億' },
  maxpainlevel: { term: '最大痛苦點', short: '讓選擇權買方整體拿回最少錢的結算價：Σ 買權未平倉 × max(0, S−K) + Σ 賣權未平倉 × max(0, K−S) 最小的那個履約價。' },
  expmove: { term: '預期波動', short: '市場預期到結算前的 ±1σ 波動：現價 × 價平 IV × √(天數 / 365)，大約 68% 的結果落在區間內。', example: '46,185 × 24.3% × √(3/365) ≈ ±1,017' },
  pnlheat: { term: '損益表（價格 × 日期）', short: '每一列是一個標的價格（約間隔 1%），每一欄是一個日期（今天到最近到期日），格子是那天那個價格的部位損益。紅 = 賺、綠 = 賠，顏色越深金額越大。未扣手續費。' },
  volcone: { term: '波動率錐', short: '5 / 10 / 20 / 60 天的歷史實際波動範圍：最小 / 最大（虛線）、25–75% 區間、中位數，以及今天的值（金點）。紫色虛線是目前價平 IV —— 高於區間代表選擇權比平常貴。' },
  keylevels: { term: '關鍵價位（歷史觸及率）', short: '本站自己的價位組，每個附上歷史上真的被碰到的比例。樞軸用前一交易日高低收：P = (高+低+收)/3、R1 = 2P−低、S1 = 2P−高、R2/S2 = P ± 振幅。觸及率 = 過去每個交易日，隔天的高（上方價位）或低（下方價位）有碰到的比例。', example: '壓力一 47,123 · 54% → 過去 250 天裡，有 54% 的日子最高價碰到當天的壓力一' },
  costline: { term: '成本線', short: '（當日最高 + 當日最低）÷ 2，四捨五入。只有創新高或新低時才會移動，所以畫出來像樓梯。價格在上方 = 空方被套；在下方 = 多方被套。開盤前用前一交易日的高低。', example: '高 22,211 · 低 22,048 → 22,130' },
  intraday: { term: '當日走勢 / 多空差額', short: '每分鐘收盤價加上成本線；下方的多空差額 = 每分鐘外盤口數 − 內盤口數的累計。接永豐即時時用交易所的內外盤標記；用期交所逐筆檔時以價格漲跌近似（上漲算外盤、下跌算內盤）。' },
  top20: { term: '權值股 TOP20', short: '加權指數權重最大的 20 檔股票（期交所每月公布權重），以及前一交易日的漲跌。看有幾檔大型股在漲、背後有多少權重（台積電一檔就超過 40%）。' },
  premarket: { term: '盤前脈絡', short: '08:45 開盤前要看的海外行情：美股期指、費半、VIX、台積電 ADR 換算價與溢價、美元兌台幣。ADR 換算 = TSM × 匯率 ÷ 5。需要本機 IB 連線。', example: 'TSM 432.96 × 31.63 ÷ 5 = 2,739，對 2330 收盤 2,410 → 溢價 +13.6%' },
  twseflows: { term: '台股籌碼日報', short: '證交所收盤後的兩張表：三大法人買賣超（外資、投信、自營商，元），以及融資融券餘額與增減。常見解讀：外資大賣而融資增加 = 散戶槓桿在接外資的賣壓。' },
  theo: { term: '理論價', short: '用 Black-76（以期貨為標的）在同一個波動率下算出的價格，旁邊是市價。選「價平 IV」時差額代表偏斜溢價；選「20日 HV」時差額代表市場比實際波動多收了多少。+ = 市價高於模型、− = 低於模型。' },
  kzoom: { term: 'K 線縮放', short: '滾輪以游標為中心縮放、拖曳平移；「重設」回到預設範圍。均線和 RSI 一律用整段資料計算，畫面邊緣也正確。' },
  rangelevels: { term: '關卡價（一壘到場外）', short: '當日目標價：以近一個月日盤振幅計算，從今日低點往上、今日高點往下。一壘 = 最小振幅、二壘 = 30 百分位、三壘 = 平均振幅、全壘 = 平均 + 1σ、場外 = 最大振幅。開盤前用前一交易日的高低。', example: '月最小振幅 170 · 今日高 22,211 → 下方一壘 22,041' },
  top10: { term: '十大交易人淨部位', short: '台指期近月前十大交易人的多單減空單（期交所大額交易人報表）。' },
};

// Drawer sections. `tabs` lists the workspaces a section is relevant to; on open
// the drawer scrolls to the first section matching the current workspace.
const HELP_SECTIONS = [
  { id: 'levels', tabs: ['levels'], title: '關卡頁 · 當沖怎麼看', paras: [
    '左邊「今日關鍵價位」把今天要注意的價位由高到低排好，現價夾在中間，每個價位右邊是離現價幾點（紅 = 上方壓力、綠 = 下方支撐）。',
    '包含：壓力 / 支撐（買權 / 賣權未平倉最大的履約價）、最大痛苦點、成本線，以及樞軸 P、R1、R2、S1、S2（用前一交易日的高、低、收算出）。',
    '中間的走勢圖可切「當日」1 / 5 / 15 / 30 / 60 分 K（日盤或全日盤），或日 K、週 K、月 K；P、R1、R2、S1、S2 直接畫在當日和日 K 上。',
    '右邊四張卡：外資期貨淨部位、P/C 未平倉比、十大交易人、散戶多空比。往下捲是「籌碼總覽」：外資、投信、自營商、大額交易人、散戶各自偏多還是偏空；圓環顏色：深紅 = 買權買方、淺紅 = 買權賣方、深綠 = 賣權買方、淺綠 = 賣權賣方。',
    '籌碼和未平倉都是期交所收盤後公布的「前一交易日」資料，每個交易日約 16:30 更新。',
    '最下面「更多分析」是其他圖表（各履約價未平倉、Gamma 曝險、關卡價、歷史觸及率…），按右上「調整版面」可以拖曳、縮放。',
  ] },
  { id: 'labs', tabs: ['levels'], title: '✨ 實驗室精選', paras: [
    '市場隱含機率地圖：把每個到期日所有履約價的權利金，換算成「市場認為結算價會落在哪」的分布（Breeden–Litzenberger：買權價格對履約價的二次微分）。山越高的地方越可能；底下粗線是 68% 區間；灰色虛線是只用價平 IV 的常態假設，彩色曲線左尾比它厚，代表市場替大跌付了比較多保險費。游標移到任何價位，右邊表格就列出每個到期日結算在那個價位以上／以下的機率。這是風險中立機率，不是預測。',
    '籌碼指標回測：把每個交易日依散戶多空比、P/C 比、外資部位的高低分成三等份，比較最高與最低三分之一之後台指期隔天、5 天的平均漲跌和上漲機率，並用 t 檢定判斷差距是否站得住（|t| ≥ 2）。5 天報酬彼此重疊，t 已除以 √5。資料只有幾個月，「看不出差別」代表證據不夠，不代表沒用；樣本每天自動增加。',
  ] },
  { id: 'chart', tabs: ['chart'], title: 'K 線頁', paras: [
    '和關卡頁同一張圖的放大版，多了 RSI。「當日」= 最近一個交易日的分 K（接永豐即時時是今天的），全日盤 = 前一晚 15:00 夜盤開始一直到日盤收盤。',
    '日 K 上會畫機率錐：從最新收盤往右，±1σ / ±2σ 是 IV 推算的到期前波動範圍。',
  ] },
  { id: 'backtest', tabs: ['backtest'], title: '回測 · 用規則測台指期策略', paras: [
    '最上面可以直接用中文描述策略，按「用 AI 解析並回測」，Claude 會把描述轉成下面的條件並馬上回測，也會列出它做的假設和做不到的部分；說「停損改 200」這類話會修改目前的策略。第一次要貼上自己的 Claude API 金鑰（Claude Console → API Keys），金鑰只存在這台瀏覽器，描述直接送到 Anthropic，不經過這個網站的伺服器；每次約 US$0.02–0.05，從你的 API 額度扣。',
    '左邊設定策略：做多或放空、大台或小台和口數、進場條件（全部成立才進場）、停損／停利點數、最多持有天數、出場條件（任一成立就出場）。上方可以先點範例策略，自己的策略按「儲存」會留在這台瀏覽器。',
    '規則：收盤後判斷條件，隔天開盤成交，不偷看未來。停損停利用持有期間每天的最高最低價判斷，跳空穿過就用開盤價，同一天兩個都碰到算停損。成本含手續費、期交稅（契約價值 0.002%）和每邊滑價。',
    '結果：總損益和「同期間同方向一直抱著」比較、交易次數、勝率、平均每筆、獲利因子（總賺 ÷ 總賠）、最大回撤、最長連賠，權益曲線和交易明細。回測期間從條件用到的資料都有的那天開始：台指期日 K 和 P/C 比從 2020 年、外資和散戶多空比從 2023 年 11 月。',
    '策略健檢：每次回測完自動檢查 8 項常見陷阱 —— 交易次數、前後半段是否都賺、逐年表現、參數各調 ±20% 是否仍賺、滑價加重、拿掉最賺 3 筆、和隨機進場比（同出場規則跑 200 次）、報酬回撤比，給 A–D 等級。',
    '「請 AI 檢討並提出改良版」：Claude 讀回測和健檢結果，用白話說問題，提出最多 3 個改良版；每個版本網站都會自己回測和健檢，數字是引擎算的，不是 AI 說的。挑版本時看健檢等級和前後半段，不要只看總損益。',
    '回測好看不代表未來會賺。條件調得越細、試得越多次，越容易只是剛好符合過去；可以把期間切成前後兩段，前段調好、後段驗證。',
  ] },
  { id: 'chain', tabs: ['chain'], title: '報價表', paras: [
    '左邊買權（紅）、右邊賣權（綠），中間是履約價。欄位：未平倉、量、Δ、IV、買價 / 賣價、理論價和差額。',
    '點任一個報價就能加入部位，再選買或賣。',
  ] },
  { id: 'surface', tabs: ['lab'], title: '實驗室 · 3D 損益曲面', paras: [
    '橫軸 = 標的價格、縱深 = 時間（前緣今天、後緣到期）、高度和顏色 = 損益（金 = 賺、藍 = 賠）。',
    '游標移上去看數字；拖曳旋轉、滾輪縮放。',
  ] },
  { id: 'payoff', tabs: ['calc', 'chain'], title: '到期損益圖', paras: [
    '實線是最近到期日時，不同標的價格下的損益。拖曳下方時間軸可以比較今天和到期。',
    '紫色標記是損益兩平點；陰影是 IV 推算的 ±1σ / ±2σ 預期波動。',
  ] },
  { id: 'greeks', tabs: ['calc', 'chain'], title: '希臘值', paras: [
    'Δ Delta：標的每動 1 點，部位變多少。',
    'Γ Gamma：Delta 變化的速度。',
    'Θ Theta：每天流失的時間價值。',
    'V Vega：IV 每變 1%，部位變多少。',
    'ρ Rho：利率每變 1%，部位變多少。',
  ] },
  { id: 'dist', tabs: ['calc', 'chain'], title: '損益分布與獲利機率', paras: [
    '依到期時的機率（對數常態）加權每個結果。紅 = 獲利、綠 = 虧損。',
    '獲利機率 = 到期時落在損益兩平以上的總機率。',
  ] },
  { id: 'futures', tabs: ['calc', 'chain'], title: '期貨部位', paras: [
    '「＋ 期貨」以現價加入一口期貨；價格欄是進場價，類型按鈕可切換契約（台指：大台 每點 200 元、小台 50 元、微台 10 元）。期貨 Delta 固定、沒有 Gamma / Theta / Vega，可以和選擇權組成掩護性買權、保護性賣權、領口。',
    '期貨手續費一樣算佣金，加上期交稅（契約價值 0.002%）。標的一直漲（或跌）就一直賺（或賠）的部位，最大獲利（或虧損）顯示「無上限」。',
  ] },
  { id: 'whatif', tabs: ['calc', 'chain', 'chart', 'lab', 'levels'], title: '模擬情境', paras: [
    '右下角的「模擬情境」可以把現價和 IV 改成假設值，全站跟著重算，不會動到你的真實部位 —— 快速壓力測試。點一下展開。',
  ] },
  { id: 'fees', tabs: ['calc', 'chain'], title: '手續費', paras: [
    '損益卡片已扣估計的來回佣金和交易稅。實際依券商而定，各商品可分別設定。',
  ] },
  { id: 'iv', tabs: ['lab'], title: '實驗室 · IV 曲面', paras: [
    '每個履約價（橫軸）和到期日（縱深）的隱含波動率。穀物選擇權偏向買權（怕乾旱上漲）；台指這類指數選擇權偏向賣權（避險買下跌保護）。',
    'IV 對 HV：高於 ×1 代表選擇權比實際波動貴（利於賣方）；低於 ×1 代表便宜（利於買方）。',
    '期限結構列出每個到期日的價平 IV；Skew · 25Δ 是 25 Delta 賣權和買權的 IV 差，正值代表下跌保護比較貴。',
  ] },
];

// ⑧a — hover tooltip on a single label. Reads theme from body.light so callers
// don’t have to thread it. Renders `children` plainly if there is no copy for k.
function HelpTip({ k, children }) {
  const info = HELP_COPY[k];
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  if (!info) return children || null;
  const show = () => {
    const r = ref.current && ref.current.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom });
  };
  const dark = typeof document !== 'undefined' && !document.body.classList.contains('light');
  const W = 240;
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)}
      style={{ borderBottom: '1px dotted', borderColor: 'currentColor', cursor: 'help', paddingBottom: 1 }}>
      {children}
      {pos && (
        <div style={{
          position: 'fixed',
          left: Math.max(8, Math.min(pos.x, window.innerWidth - W - 8)),
          top: Math.min(pos.y + 8, window.innerHeight - 130),
          zIndex: 60, width: W, padding: '10px 12px', borderRadius: 10,
          background: dark ? 'linear-gradient(155deg, rgba(80,90,115,0.96), rgba(30,36,50,0.98))' : 'rgba(255,255,255,0.99)',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(25,40,70,0.16)'}`,
          boxShadow: '0 20px 48px -18px rgba(0,0,0,0.7)', color: dark ? '#e8eaef' : '#1c2433',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          fontFamily: 'var(--font-display)', pointerEvents: 'none', textTransform: 'none', letterSpacing: 0,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{info.term}</div>
          <div style={{ fontSize: 11, lineHeight: 1.5, opacity: 0.85 }}>{info.short}</div>
          {info.example && <div style={{ fontSize: 10, marginTop: 6, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>{info.example}</div>}
        </div>
      )}
    </span>
  );
}

// ⑧b — the glossary drawer. Fixed to the right, scrollable, Esc / × to close.
function HelpDrawer({ open, onClose, workspace }) {
  const bodyRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  React.useEffect(() => {
    if (!open || !bodyRef.current) return;
    const sec = HELP_SECTIONS.find((s) => s.tabs.includes(workspace));
    const el = sec && bodyRef.current.querySelector(`#help-${sec.id}`);
    if (el) el.scrollIntoView({ block: 'start' });
  }, [open, workspace]);
  if (!open) return null;
  const dark = !document.body.classList.contains('light');
  return (
    <div style={{
      position: 'fixed', right: 18, top: 90, bottom: 18, width: 'min(360px, calc(100vw - 48px))', zIndex: 55,
      borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: 'var(--panel)', border: '1px solid var(--border)',
      boxShadow: '0 24px 60px -20px rgba(0,0,0,0.45)', color: 'var(--text)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(25,40,70,0.08)'}` }}>
        <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>怎麼看這些數字</span>
        <button onClick={onClose} title="關閉（Esc）" style={{ width: 24, height: 24, borderRadius: 12, border: `1px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(25,40,70,0.14)'}`, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
      </div>
      <div ref={bodyRef} style={{ overflowY: 'auto', padding: '4px 16px 18px' }}>
        {HELP_SECTIONS.map((s) => {
          const active = s.tabs.includes(workspace);
          return (
            <div key={s.id} id={`help-${s.id}`} style={{ padding: '14px 0', borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(25,40,70,0.06)'}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                {s.title}
                {active && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'var(--blue)', color: '#fff' }}>本頁</span>}
              </div>
              {s.paras.map((para, i) => (
                <div key={i} style={{ fontSize: 12.5, lineHeight: 1.7, opacity: 0.85, marginBottom: 7 }}>{para}</div>
              ))}
            </div>
          );
        })}
        <div style={{ fontSize: 10, opacity: 0.45, paddingTop: 12 }}>小技巧：游標移到有虛線底線的標題上，會跳出簡短說明。</div>
      </div>
    </div>
  );
}

Object.assign(window, { HELP_COPY, HELP_SECTIONS, HelpTip, HelpDrawer });
