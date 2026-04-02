#!/usr/bin/env node
/**

BTO on Shopify - サンプルデータ生成スクリプト
G-Tune FZ-I9G90 の全BTO構成データをJSONファイルとして生成します。
使い方:
node scripts/generate-bto-fz-i9g90.js
→ bto-configs/fz-i9g90.json が生成されます
*/
const fs = require('fs');
const path = require('path');

// ============================================================
// ヘルパー関数
// ============================================================

/** 固定スペック（選択不可） */
function fixed(name, slug, sortOrder, value) {
return { name, slug, type: 'fixed', sort_order: sortOrder, fixed_value: value };
}

/** 単一選択カテゴリ（ラジオボタン） */
function singleSelect(name, slug, sortOrder, options, extra = {}) {
return { name, slug, type: 'single_select', sort_order: sortOrder, ...extra, options };
}

/** 複数選択カテゴリ（チェックボックス） */
function multiSelect(name, slug, sortOrder, options) {
return { name, slug, type: 'multi_select', sort_order: sortOrder, options };
}

/** 選択肢 */
function opt(name, priceIncl, priceExcl, { isDefault = false, isRecommended = false, sizeGroup = undefined } = {}) {
const o = { name, price_incl: priceIncl, price_excl: priceExcl, is_default: isDefault, is_recommended: isRecommended };
if (sizeGroup !== undefined) o.size_group = sizeGroup;
return o;
}

/** デフォルト選択肢（価格差0） */
function defaultOpt(name) {
return opt(name, 0, 0, { isDefault: true });
}

// ============================================================
// ハードウェア構成
// ============================================================

const hardwareConfig = {
sections: [
singleSelect('OS', 'os', 1, [
defaultOpt('Windows 11 Home 64ビット（Microsoft 365 Personal体験版付属）'),
opt('Windows 11 Pro 64ビット（Microsoft 365 Personal体験版付属）', 8800, 8000),
]),

fixed('CPU', 'cpu', 2,
  'インテル(R) Core(TM) Ultra 9 プロセッサー 285K (24コア / 8 P-cores / 16 E-cores / 24スレッド / 最大5.7GHz / 36MB)'),

fixed('CPUファン', 'cpu_fan', 3,
  '水冷CPUクーラー (360mm長の大型ラジエーターで強力冷却) ※ケースファンが4個以上のケースと組み合わせてください'),

singleSelect('CPUグリス', 'cpu_grease', 4, [
  defaultOpt('標準CPUグリス'),
  opt('【高熱伝導率】シルバーグリス AINEX AS-05 ⇒ 純銀度99.9%の超微粒子が熱伝導率を向上！', 1320, 1200),
  opt('【優れた熱伝導率】ナノダイヤモンドグリス JP-DX1 ⇒ 高純度熱伝導材料でつくられた高品質のダイヤモンドグリス', 1980, 1800),
  opt('【高耐久性能】Thermal Grizzly Kryonaut ⇒ 乾燥に強く長期間冷却性能を維持', 3190, 2900),
]),

singleSelect('メモリ', 'memory', 5, [
  defaultOpt('64GB メモリ [ 32GB×2 ( DDR5-5600 ) / デュアルチャネル ]'),
  opt('128GB メモリ [ 32GB×4 ( DDR5-4400 ) / デュアルチャネル ]', 343200, 312000),
]),

singleSelect('SSD (M.2)', 'ssd_m2', 6, [
  defaultOpt('2TB NVMe SSD ( M.2 PCIe Gen5 x4 接続 )'),
  opt('2TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 61600, 56000),
  opt('4TB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 127600, 116000),
  opt('4TB NVMe SSD TLC ( M.2 PCIe Gen4 x4 接続 )', 129800, 118000),
  opt('4TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 138600, 126000),
]),

singleSelect('SSD', 'ssd', 7, [
  defaultOpt('・・・ 無し'),
  opt('500GB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 17600, 16000),
  opt('1TB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 30800, 28000),
  opt('1TB NVMe SSD TLC ( M.2 PCIe Gen4 x4 接続 )', 33000, 30000),
  opt('1TB NVMe SSD ( SAMSUNG PM9A1 / M.2 PCIe Gen4 x4 接続 )', 40700, 37000),
  opt('2TB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 48400, 44000),
  opt('1TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 49500, 45000),
  opt('2TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 88000, 80000),
  opt('2TB NVMe SSD TLC ( M.2 PCIe Gen4 x4 接続 )', 118800, 108000),
  opt('4TB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 154000, 140000),
  opt('4TB NVMe SSD TLC ( M.2 PCIe Gen4 x4 接続 )', 156200, 142000),
  opt('4TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 165000, 150000),
  opt('8TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 275000, 250000),
]),

singleSelect('SSDまたはHDD', 'ssd_or_hdd', 8, [
  defaultOpt('・・・ 無し'),
  opt('500GB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 17600, 16000),
  opt('1TB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 30800, 28000),
  opt('1TB NVMe SSD TLC ( M.2 PCIe Gen4 x4 接続 )', 33000, 30000),
  opt('1TB NVMe SSD ( SAMSUNG PM9A1 / M.2 PCIe Gen4 x4 接続 )', 40700, 37000),
  opt('2TB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 48400, 44000),
  opt('1TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 49500, 45000),
  opt('2TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 88000, 80000),
  opt('2TB NVMe SSD TLC ( M.2 PCIe Gen4 x4 接続 )', 118800, 108000),
  opt('4TB NVMe SSD ( M.2 PCIe Gen4 x4 接続 )', 154000, 140000),
  opt('4TB NVMe SSD TLC ( M.2 PCIe Gen4 x4 接続 )', 156200, 142000),
  opt('4TB NVMe SSD ( WD_BLACK SN850X / M.2 PCIe Gen4 x4 接続 )', 165000, 150000),
]),

singleSelect('HDD', 'hdd', 9, [
  defaultOpt('・・・ HDD無し'),
  opt('1TB HDD', 22000, 20000),
  opt('2TB HDD', 31900, 29000),
  opt('4TB HDD', 50600, 46000),
  opt('8TB HDD', 72600, 66000),
]),

fixed('グラフィックス', 'gpu', 10,
  'NVIDIA GeForce RTX 5090 / 32GB ( DisplayPort×3 / HDMI×1 )'),

singleSelect('光学ドライブ', 'optical_drive', 11, [
  defaultOpt('・・・ 光学ドライブ非搭載'),
  opt('DVDスーパーマルチドライブ ( DVD±R DL 読み書き対応 )', 4180, 3800),
  opt('Blu-rayディスクドライブ ( BDXL(TM) 読み書き対応 )', 14850, 13500),
]),

singleSelect('光学ドライブ（外付け）', 'optical_drive_ext', 12, [
  defaultOpt('・・・ 外付け光学ドライブなし'),
  opt('[ USB2.0 ] DVDスーパーマルチドライブ ( DVD±R DL 対応 )', 5390, 4900),
  opt('[ USB3.2 Gen1 ] Blu-rayディスクドライブ ( BDXL(TM) 対応 / ブラック / Type-A Type-C対応 )', 20890, 18991),
]),

fixed('カードリーダー', 'card_reader', 13, '・・・ カードリーダー無し'),
fixed('電源', 'psu', 14, '1200W 電源 ( 80PLUS(R) Platinum )'),
fixed('マザーボード', 'motherboard', 15, 'インテル(R) Z890 チップセット ( ATX / SATA 6Gbps 対応ポートx4 / M.2スロットx3 )'),
fixed('ケース', 'case', 16, '【G TUNE】フルタワーケース 強化ガラスサイドパネル ( ケースファン 前面×3 / 上面×3 / 背面×1 搭載 )'),
fixed('サウンド', 'sound', 17, 'ハイデフィニション・オーディオ'),
fixed('LAN', 'lan', 18, '[オンボード]Marvell(R) AQC113 100M/1G/2.5G/5G/10G BASE-T Ethernet LAN'),
fixed('無線LAN', 'wireless_lan', 19, 'Wi-Fi 6E ( 最大2.4Gbps ) 対応 IEEE 802.11 ax/ac/a/b/g/n準拠 ＋ Bluetooth 5内蔵 ( Windows 10はWi-Fi 6動作 )'),

singleSelect('拡張カード', 'expansion_card', 20, [
  defaultOpt('・・・ 拡張カードなし'),
  opt('LR-LINK 10GbE ネットワークカード ( LRES2051PT / RJ45 / PCI Express x4 ) ※Cat.6A以上のケーブルをご利用ください。', 13970, 12700),
]),

singleSelect('拡張カード2', 'expansion_card_2', 21, [
  defaultOpt('・・・ 拡張カードなし'),
  opt('【デスクトップパソコンの電源を机上に入れられる！】デスクトップ用外付け電源スイッチ増設', 2970, 2700),
]),
],
};

// ============================================================
// 周辺機器構成
// ============================================================

const peripheralConfig = {
sections: [
singleSelect('配信・実況向けデバイス', 'streaming_device', 1, [
defaultOpt('・・・ 選択無し'),
opt('[ マイク / USB有線 ] Razer Seiren V3 Mini (ホワイト / タップトゥミュート機能、LEDインジケーター搭載)', 8360, 7600),
opt('[ マイク / USB有線 ] AVerMedia LIVE STREAMER MIC AM310G2 ( ストリーミング・ゲームに最適 / 単一指向性 / 音量調整・消音ボタン搭載 )', 9900, 9000),
opt('[ マイク / USB有線 ] HyperX QuadCast 2 ( ホワイト / タッチ式ミュート機能 / フルアルミボディ )', 19800, 18000),
opt('[ キャプチャーボード ] AVerMedia LIVE GAMER EXTREME 3 GC551G2 (ソフトウェアエンコード / 録画最大 3840x2160@30fps、2560x1440@60fps)', 19800, 18000),
opt('[ 2点セット！ マイク+キャプチャーボード ] Razer Seiren V3 Mini (ホワイト) + AVerMedia LIVE GAMER EXTREME 3 GC551G2', 28160, 25600),
opt('[ 2点セット！ マイク+キャプチャーボード ] AVerMedia LIVE STREAMER MIC AM310G2 + AVerMedia LIVE GAMER EXTREME 3 GC551G2', 29700, 27000),
opt('[ 2点セット！ マイク+キャプチャーボード ] HyperX Quadcast 2 (ホワイト) + AVerMedia LIVE GAMER EXTREME 3 GC551G2', 39600, 36000),
]),

singleSelect('外付け拡張デバイス', 'ext_expansion_device', 2, [
  defaultOpt('・・・ 外付け拡張デバイスなし'),
  opt('[ 左手デバイス / USB有線 ] Elgato Stream Deck Mini ( 6ボタン / 様々な操作、アクションが登録可能なショートカットキーボード )', 12980, 11800),
  opt('[ 左手デバイス / USB有線 ] Logicool MX Creative Console ( 9ボタンのキーパッド / 微細な調整ができるダイアルパッド )', 29800, 27091),
]),

singleSelect('外付けストレージ', 'ext_storage', 3, [
  defaultOpt('・・・ 外付けストレージなし'),
  opt('[ USB3.0対応 外付けポータブルSSD ] エレコム ESD-EJ0500GBKR ( 500GB / 持ち運びやすい薄型SSD )', 13750, 12500),
  opt('[ USB3.0対応 外付けHDD ] BUFFALO HD-NRLD2.0U3-BA ( 2TB / ファンレス設計 / 防振設計 )', 15950, 14500),
  opt('[ USB3.0対応 外付けHDD ] BUFFALO HD-NRLD4.0U3-BA ( 大容量の4TB / 静音設計 / 電源連動機能で省エネ )', 20900, 19000),
  opt('[ USB3.0対応 外付けHDD ] BUFFALO HD-NRLD6.0U3-BA ( 6TB / ファンレス設計 / 防振設計 )', 26400, 24000),
  opt('[ USB3.0対応 外付けポータブルSSD ] エレコム ESD-EMC1000GBK ( 1TB / キャップ付きで持ち運びしやすいコンパクトなスティック型SSD )', 26400, 24000),
  opt('[ USB3.0対応 外付けポータブルSSD ] エレコム ESD-EJ2000GBKR ( 2TB / 持ち運びやすい薄型SSD )', 36300, 33000),
]),

singleSelect('キーボード', 'keyboard', 4, [
  defaultOpt('・・・ キーボードなし'),
  opt('[ USB有線 ] HyperX Alloy Core RGBメンブレンゲーミングキーボード ( メンブレンスイッチ / 日本語レイアウト / RGBバックライトキー )', 4950, 4500),
  opt('[ USB有線 ] オリジナルメカニカルゲーミングキーボード ( ブラック / 日本語 )', 5280, 4800, { isRecommended: true }),
  opt('[ USB有線 ] オリジナルメカニカルゲーミングキーボード ( ホワイト / 日本語 )', 5280, 4800),
  opt('[ USB有線 ] Logicool RGB Keyboard G213r ( ブラック / メンブレン / RGBバックライトキー / 日本語 )', 7920, 7200),
  opt('[ USB有線 ] G TUNEオリジナル ラピッドトリガーキーボード ( ブラック / 日本語 / アクチュエーションポイント / Nキーロールオーバー )', 10780, 9800, { isRecommended: true }),
  opt('[ USB有線 ] Logicool PRO G-PKB-002LN ( GX RED リニア軸 / テンキーレス / 12個のプログラマブルFキー / 日本語 )', 17050, 15500),
  opt('[ USB無線 / Bluetooth ] Logicool G515-WL-LNWH ( ホワイト / テンキーレス / 22mmの超ロープロファイル / リニア軸 / 日本語 )', 19800, 18000),
  opt('[ USB無線 / Bluetooth ] Logicool G715WL-LN ( ホワイト / 日本語 / テンキーレス / コンパクトデザイン / リニア軸 )', 22980, 20891, { isRecommended: true }),
  opt('[ USB有線 ] Logicool G-PKB-TKL-RTBK (ブラック/ 日本語 /ラピッドトリガー、アクチュエーションポイント、KEY PRIORITY機能設定可能)', 29700, 27000),
]),

singleSelect('マウス', 'mouse', 5, [
  defaultOpt('・・・ マウスなし'),
  opt('[ USB有線 ] 7ボタンオリジナルゲーミングマウス ( ホワイト / dpiが6段階で変更可能 )', 1980, 1800),
  opt('[ USB有線 ] 7ボタンオリジナルゲーミングマウス ( ブラック / dpiが6段階で変更可能 )', 1980, 1800),
  opt('[ USB有線 ] Logicool G402 ( 8ボタン / フュージョン エンジン搭載で高速トラッキングを実現 / FPS向けモデル )', 5610, 5100),
  opt('[ USB無線 ] Logicool G304 ( ブラック / 6ボタン / 最大12000dpi / 重量わずか99gの超軽量設計 )', 5720, 5200),
  opt('[ USB無線 ] Logicool G304rWH ( ホワイト / 6ボタン / 最大12000dpi / 重量わずか99gの超軽量設計 )', 5720, 5200),
  opt('[ USB無線 ] G TUNEオリジナル ワイヤレスゲーミングマウス ( 軽量38g / 50〜26000dpi切替 / 専用レシーバー )', 6930, 6300, { isRecommended: true }),
  opt('[ USB無線 ] Logicool G703h ( HEROセンサー / 6個のプログラマブルボタン / LIGHTSYNC RGB )', 10890, 9900),
  opt('[ USB無線 ] Logicool PRO X SUPERLIGHT ( ブラック / 軽量63g / HERO 25Kセンサー / 1回の充電で約70時間の連続使用 )', 14500, 13182),
]),

singleSelect('マウスパッド', 'mousepad', 6, [
  defaultOpt('・・・ マウスパッドなし'),
  opt('[ クロス素材 ] Logicool G240f Cloth Gaming Mouse Pad ( 280mm×340mm / 低DPIの操作にもスムーズに対応 )', 1870, 1700),
  opt('[ ハード素材 ] Logicool G440f Hard Gaming Mouse Pad ( 280mm×340mm / 高DPI設定のマウスに最適な低表面摩擦 )', 2750, 2500),
  opt('G TUNEオリジナル アルファゲル採用 マウスパッド-M ( 320mm*270mm*3mm )', 2750, 2500, { isRecommended: true }),
  opt('G TUNEオリジナル アルファゲル採用 マウスパッド-L ( 490mm*420mm*3mm )', 3630, 3300, { isRecommended: true }),
  opt('[ クロス素材 ] Logicool G640s Large Cloth Gaming Mouse Pad ( 大判 400mm×460mm / 低DPIの操作にもスムーズに対応 )', 3850, 3500),
]),

fixed('ペンタブレット', 'pen_tablet', 7, '・・・ 選択なし'),

singleSelect('スピーカー', 'speaker', 8, [
  defaultOpt('・・・ スピーカーなし ( 音声出力にはスピーカーが別途必要です )'),
  opt('[2ch/4Wx2] Creative Pebble V2 (USBバスパワーでの動作が可能なコンパクト スピーカー)', 3960, 3600, { isRecommended: true }),
  opt('[2ch/8W RMS] Creative Pebble V3 ホワイト (USB-C・Bluetooth・ライン入力に対応、高ゲインモード切替可能)', 5940, 5400),
  opt('[ 2ch/30Wx2 ] Creative T60 ( 複数の端子で様々な機器に接続可能なスピーカー / Bluetoothも対応 )', 11000, 10000),
  opt('[10W出力] Jabra SPEAK510 MS (Bluetooth＆USB Type-A接続対応 オンライン会議に最適なスピーカーフォン)', 17600, 16000, { isRecommended: true }),
]),

singleSelect('ヘッドフォン', 'headphone', 9, [
  defaultOpt('・・・ ヘッドフォンなし'),
  opt('[ USB無線 / Bluetooth ] Logicool G435BK ワイヤレスゲーミングヘッドセット ( ブラック / 直径40mmドライバー / 軽量165g )', 7678, 6980),
  opt('[ USB有線 ] G TUNEオリジナル ゲーミングヘッドセット ( USB接続 / チタンコーティングドライバー / 着脱可能なマイク )', 8580, 7800, { isRecommended: true }),
  opt('[ USB無線 / Bluetooth ] Logicool G321-WH ワイヤレスゲーミングヘッドセット ( ホワイト / 直径40mmドライバー / 軽量210g )', 9350, 8500),
  opt('[ USB有線 / 7.1ch ] Logicool G431 DTS 7.1 サラウンド ゲーミング ヘッドセット ( 直径50mmドライバー / ノイズキャンセリングマイク )', 9900, 9000),
  opt('[ USB有線 / 7.1ch ] Logicool PRO X G-PHS-003 ( USB外付けDACによって透き通るようなクリアなデジタル信号処理を実現 )', 16390, 14900),
  opt('[ USB無線 / Bluetooth ] Logicool G735WL ( ホワイト / 直径40mmドライバー / 最大56時間のバッテリー動作 )', 24800, 22546, { isRecommended: true }),
]),

singleSelect('ゲームコントローラ', 'game_controller', 10, [
  defaultOpt('・・・ ゲームコントローラなし'),
  opt('【有線】ロジクール Gamepad F310r (USB接続/プログラム可能アナログミニジョイスティック搭載)', 2860, 2600, { isRecommended: true }),
  opt('【有線】HyperX Clutch Gladiate ( XBOX公認 / プログラマブルボタン / 3.5mmステレオポート搭載 )', 3980, 3619, { isRecommended: true }),
  opt('【有線&Bluetooth】 Microsoft Xboxコントローラー ( 2.7mType-Cケーブル付属 / Bluetooth対応 )', 9130, 8300),
]),

singleSelect('WEBカメラ（オプション）', 'webcam', 11, [
  defaultOpt('・・・ 外付けWebカメラなし'),
  opt('Logicool HD Webcam C270n ( USB2.0 / HD 720p ビデオ会議 )', 3080, 2800),
  opt('Logicool BRIO 100 ( ホワイト / 1080p 30fps / 固定フォーカス / プライバシーシャッター付 )', 4950, 4500),
  opt('Logicool C922N PRO STREAM WEBCAM (1080p 30fps / 720p 60fps / オートフォーカス / 3ヵ月間のXSplitプレミアムライセンス)', 12100, 11000),
]),

singleSelect('モニタ', 'monitor', 12, [
  opt('・・・ モニタなし', 0, 0, { isDefault: true, sizeGroup: null }),
  opt('[ 21.5型 IPS方式パネル ] Acer EK220QE3bi ( 1920×1080 / 100Hz対応 / HDMI,D-SUB / スピーカー付属無し )', 11000, 10000, { sizeGroup: '21.5型ワイド液晶' }),
  opt('[ 21.45型 IPS方式パネル ] iiyama XUB2293HSU-B7 ( 1920×1080 / DisplayPort,HDMI / USBハブ / 昇降・回転対応 )', 19910, 18100, { sizeGroup: '21.5型ワイド液晶' }),
  opt('[ 23.8型 IPS方式パネル ] ProLite XB2491HS-B1J ( 1920×1080 / DisplayPort HDMI / 120Hz )', 18920, 17200, { sizeGroup: '23.8型ワイド液晶' }),
  opt('[ 23.8型 IPS方式ゲーミング液晶 ] G-MASTER G2445HSU-B2 (ブラック / 1920×1080 / DisplayPort HDMI / 100Hz・応答速度1.0ms )', 18920, 17200, { sizeGroup: '23.8型ワイド液晶' }),
  opt('[ 23.8型 IPS方式パネル ] iiyama ProLite X2492HSU-B1J ( ブラック / 1920×1080 / DisplayPort,HDMI / USBハブポート )', 20900, 19000, { sizeGroup: '23.8型ワイド液晶' }),
  opt('[ 23.8型 IPS方式パネル ] iiyama ProLite XB2492HSU-B1J ( ブラック / 1920×1080 / DisplayPort,HDMI / 昇降・縦横90°回転 対応)', 22990, 20900, { sizeGroup: '23.8型ワイド液晶' }),
  opt('[ 23.8型 IPS方式パネル ] iiyama ProLite XUB2492HSU-W6 ( 白モデル / 1920×1080 / DisplayPort HDMI / 昇降・縦横90°回転 対応)', 22990, 20900, { sizeGroup: '23.8型ワイド液晶' }),
  opt('[ 23.8型 FAST IPS方式ゲーミング液晶 ] G-MASTER GB2470HSU-W6 (ホワイト / 1920×1080 / DisplayPort HDMI / 180Hz・高速応答0.2ms )', 26950, 24500, { sizeGroup: '23.8型ワイド液晶' }),
  opt('[ 23.8型 FAST IPS方式ゲーミング液晶 ] G-MASTER GB2471HSU-W1 (ホワイト / 1920×1080 / DisplayPort×1、HDMI×2 / 240Hz )', 26950, 24500, { sizeGroup: '23.8型ワイド液晶' }),
], { has_quantity: true }),

singleSelect('モニターアーム', 'monitor_arm', 13, [
  defaultOpt('・・・モニターアームなし'),
  opt('[ シングルアーム ] エレコム DPA-SS02BK ( ブラック / ガススプリング式 / グロメット式とクランプ式の両対応 )', 4950, 4500),
  opt('[ シングルアーム ] エレコム DPA-SS08WH ( ホワイト / ガススプリング式 / グロメット式とクランプ式の両対応 )', 4950, 4500),
  opt('[ デュアルアーム ] エレコム DPA-DL05BK ( ブラック / メカニカルスプリング式 / グロメット式とクランプ式の両対応 )', 6600, 6000),
]),

singleSelect('プリンタ', 'printer', 14, [
  defaultOpt('・・・ プリンタなし'),
  opt('[ A4モノクロレーザープリンタ ] ブラザー JUSTIO HL-L2460DW', 13970, 12700),
  opt('[ A4カラーインクジェット複合機 ] ブラザー プリビオ DCP-J929N-W ※1.5m USBケーブル付属', 20900, 19000),
  opt('[ A4カラーレーザープリンタ ] ブラザー JUSTIO HL-L3240CDW', 25300, 23000),
]),

singleSelect('ブロードバンドルーター', 'router', 15, [
  defaultOpt('・・・ ブロードバンドルーターなし'),
  opt('[ 無線LAN ] BUFFALO WSR-1500AX2L/D ( Wi-Fi 6対応 / 最大1,201Mbpsの無線LAN対応 / 有線LAN3ポート搭載 )', 6930, 6300),
  opt('[ 無線LAN ] BUFFALO WSR3600BE4P/DBK (Wi-Fi 7対応 / 最大2,882Mbpsの無線LAN対応 / 有線LAN3ポート搭載 )', 11550, 10500),
  opt('[ 無線LAN ] BUFFALO WXR9300BE6P/D (Wi-Fi 7対応 & 6GHz対応 / 最大5,764Mbpsの無線LAN対応 / 有線LAN4ポート搭載 )', 31900, 29000),
]),

singleSelect('HUB', 'hub', 16, [
  defaultOpt('・・・ HUBなし'),
  opt('[ 有線LAN ] BUFFALO LSW6-GT-8NS/DBK ( ギガビット対応 8ポート / 金属筐体 / 電源内蔵 )', 6930, 6300),
]),

singleSelect('ゲーミングチェア', 'gaming_chair', 17, [
  defaultOpt('・・・ ゲーミングチェアなし'),
  opt('【Red】 AKRacing Nitro V2 Gaming Chair (スタンダードモデル) ※PCとは別送になり到着にお時間をいただく場合がございます。', 47850, 43500),
  opt('【Pink】 AKRacing Eclair Gaming Chair (ホワイトベースモデル) ※PCとは別送になり到着にお時間をいただく場合がございます。', 47850, 43500),
  opt('【Blue】 AKRacing Eclair Gaming Chair (ホワイトベースモデル) ※PCとは別送になり到着にお時間をいただく場合がございます。', 47850, 43500),
  opt('【White】 AKRacing AKR-TSUBASA/HONDA 本田翼 監修オリジナルカラーモデル ※PCとは別送になり到着にお時間をいただく場合がございます。', 49830, 45300),
  opt('【Grey】 AKRacing Pro-X V2 Gaming Chair (ハイエンドモデル) ※PCとは別送になり到着にお時間をいただく場合がございます。', 57750, 52500),
  opt('【Red】 AKRacing Pro-X V2 Gaming Chair (ハイエンドモデル) ※PCとは別送になり到着にお時間をいただく場合がございます。', 57750, 52500),
]),

multiSelect('USB周辺機器', 'usb_peripherals', 18, [
  opt('【高速転送】エレコム USB3.0ハブ U3H-A408SBK ( ケーブル長約1m / 4ポート / ACアダプター付き /セルフ・バスパワー両対応 )', 2640, 2400),
  opt('[ UHS-II対応/USBカードリーダー ] Kingston MobileLite Plus SD リーダー ( USB3.0接続 )', 2860, 2600),
  opt('[ CFexpress Type B対応/USBカードリーダー ] サンディスク エクストリーム プロ SDDR-F451-JNGEN ( USB Type-C 3.1 Gen2接続 )', 8800, 8000),
]),

multiSelect('LANケーブル', 'lan_cable', 19, [
  opt('[ 広帯域LANケーブル ] 10m ( UTP / ストレート / カテゴリー6A )', 1650, 1500),
  opt('[ 広帯域LANケーブル ] 1m ( UTP / ストレート / カテゴリー6A )', 605, 550),
  opt('[ 広帯域LANケーブル ] 2m ( UTP / ストレート / カテゴリー6A )', 638, 580),
  opt('[ 広帯域LANケーブル ] 3m ( UTP / ストレート / カテゴリー6A )', 660, 600),
  opt('[ 広帯域LANケーブル ] 5m ( UTP / ストレート / カテゴリー6A )', 880, 800),
]),

multiSelect('サプライ', 'supply', 20, [
  opt('[ Bluetoothテンキーパッド ] エレコム TK-TBP020BK ( スリム設計 / パンタグラフ / ブラック )', 2970, 2700),
  opt('[ HDMI端子用 VGA変換アダプタ ] エレコム AD-HDMIVGABK2', 2750, 2500),
  opt('【 ケーブル 】 DisplayPortケーブル (DP-DP / 2m)', 2420, 2200),
]),
],
};

// ============================================================
// サービス構成
// ============================================================

const serviceConfig = {
sections: [
singleSelect('オフィスソフト', 'office', 1, [
defaultOpt('・・・ オフィスソフト無し'),
opt('Microsoft(R) 365 Personal ( 24か月版 ) ※試用期間後は Office H&B 2024永続版 へ変更可能', 27500, 25000, { isRecommended: true }),
opt('Microsoft(R) 365 Basic ( 1年版 ) + Office Home and Business 2024 デジタルライセンス版 ( 中小企業向け )', 27500, 25000),
opt('Microsoft(R) 365 Basic ( 1年版 ) + Office Home and Business 2024 デジタルライセンス版 ( 個人向け )', 27500, 25000, { isRecommended: true }),
opt('Microsoft(R) Office Home and Business 2024 デジタルライセンス版 ( 中小企業向け )', 27500, 25000),
opt('【総合オフィスソフト＆PDF編集】WPS Office2 PDF Plus ( ワープロ/表計算/プレゼンテーション/PDF編集 )', 3520, 3200, { isRecommended: true }),
opt('【総合オフィスソフト】 KINGSOFT WPS Office 2 Standard ダウンロード版 ( ワープロ/表計算/プレゼンテーション/PDF閲覧 )', 3190, 2900),
]),

singleSelect('ウイルス対策・セキュリティソフト', 'security', 2, [
  defaultOpt('マカフィー リブセーフ 1年版'),
  opt('・・・ 追加セキュリティソフトなし（法人・個人事業者を選択すると購入可能です）', 0, 0),
  opt('マカフィー リブセーフ 3年版 ( 1年版+2年版 )', 9900, 9000),
  opt('マカフィー リブセーフ 4年版 ( 1年版+3年版 )', 13200, 12000),
]),

singleSelect('ソフトウェア１（プリインストール）', 'software_preinstall', 3, [
  defaultOpt('Steamクライアントソフト'),
  opt('・・・ ソフトなし', 0, 0),
]),

singleSelect('ソフトウェア２（バンドル）', 'software_bundle', 4, [
  defaultOpt('・・・ ソフトなし'),
  opt('【OSごと全データ消去】ターミネータ10plusデータ完全抹消 BIOS / UEFI版（バルク版）※ダウンロードコードとDVDメディア付属', 3520, 3200),
  opt('【オールインワン画面録画ソフト】CyberLink Screen Recorder 4 Deluxe ダウンロード版 ( 簡単操作でライブ配信/画面録画/ビデオ編集 )', 4290, 3900, { isRecommended: true }),
  opt('【写真/動画編集ソフト】Adobe Photoshop Elements 2026 & Premiere Elements 2026 3年ライセンス ※ダウンロードコードが付属します', 27280, 24800),
  opt('【写真編集ソフト】 CyberLink PhotoDirector 2025 Ultra ( 各種AI関連の画像補正に対応、RAW形式に対応 )', 7480, 6800),
  opt('【常に最新の写真/音声/ビデオ/映像用色編集ソフト】CyberLink Director Suite 365（1年ライセンス）※定期契約型プランです', 11880, 10800),
  opt('【直接編集機能付きPDF編集ソフト】 KINGSOFT PDF Pro ( ファイル形式の変換や暗号化設定などに対応 / 署名機能あり )', 3960, 3600),
  opt('【動画編集ソフト】 CyberLink PowerDirector 2025 Ultra ( 各種映像編集機能と補正技術に対応。1年間、25GBのクラウドストレージ)', 11990, 10900),
]),

singleSelect('出荷日調整サービス', 'shipping_service', 5, [
  defaultOpt('・・・ 翌営業日出荷サービスなし'),
  opt('【お急ぎの方に！カスタマイズしてもすぐ届く！！】翌営業日出荷サービス', 2200, 2000, { isRecommended: true }),
]),

singleSelect('パソコン引越しソフト', 'migration_software', 6, [
  defaultOpt('・・・ パソコン引越しソフトなし'),
  opt('【データ・設定・アプリに対応】ファイナルパソコン引越し Win11 対応版(専用USBリンクケーブル付き)', 7480, 6800),
]),

singleSelect('オプションサービス', 'option_service', 7, [
  defaultOpt('・・・オプションサービス無し'),
]),

singleSelect('パソコン下取りサービス', 'trade_in', 8, [
  defaultOpt('・・・ パソコン下取りサービスなし'),
  opt('パソコン下取りサービスに申し込む', -1100, -1000),
]),

singleSelect('サポート', 'support', 9, [
  defaultOpt('[ 3年保証/PC本体] センドバック修理保証＋初期不良対応１ヵ月'),
  opt('[ 3年保証/PC本体] ピックアップ修理保証', 3300, 3000),
  opt('[ 3年保証/PC本体] センドバック修理保証+安心パックサービス(専用ダイヤル/即日修理)', 5500, 5000),
  opt('[ 3年保証/PC本体] オンサイト修理保証', 8800, 8000),
  opt('[ 3年保証/PC本体] ピックアップ修理保証+安心パックサービス(専用ダイヤル/即日修理)', 8800, 8000),
  opt('[ 3年保証/PC本体] オンサイト修理保証+安心パックサービス(専用ダイヤル/即日修理)', 14300, 13000),
]),

singleSelect('電話サポート', 'phone_support', 10, [
  defaultOpt('[ 24時間365日電話サポート ] 困った時はいつでもお電話いただけます'),
  opt('[ 安心パック限定オプション ] リモートサポートサービス追加', 3300, 3000, { isRecommended: true }),
]),

singleSelect('破損盗難保証サービス', 'damage_insurance', 11, [
  defaultOpt('・・・ 破損盗難保証サービスなし'),
  opt('破損盗難保証 レベル1 (保証限度額￥50,000-)', 6600, 6000),
  opt('破損盗難保証 レベル2 (保証限度額￥100,000-)', 9900, 9000),
  opt('破損盗難保証 レベル3 (保証限度額￥150,000-)', 14300, 13000),
  opt('破損盗難保証 レベル4 (保証限度額￥200,000-)', 19800, 18000),
]),

singleSelect('データ復旧サービス', 'data_recovery', 12, [
  defaultOpt('・・・ データ復旧サービスなし'),
  opt('データ復旧安心サービスパック 1年版 ( 1年間に最大1回まで )', 2200, 2000),
  opt('データ復旧安心サービスパック 3年版 ( 3年間に最大3回まで )', 4400, 4000, { isRecommended: true }),
  opt('データ復旧安心サービスパック 5年版 ( 5年間に最大5回まで )', 6600, 6000),
  opt('データ復旧安心プランファミリー ( 1年間に最大2回まで )', 3300, 3000),
  opt('データ復旧安心プランファミリー ×3 ( 1年間に最大2回までの保証を3年継続 )', 9900, 9000),
  opt('データ復旧安心プランファミリー ×5 ( 1年間に最大2回までの保証を5年継続 )', 16500, 15000),
]),

singleSelect('各種出張サービス', 'onsite_service', 13, [
  defaultOpt('・・・ 出張セットアップサービスなし'),
  opt('[出張設置設定/※初回のみ]プラン1：PC設置、インターネット/メール設定(有線)', 10450, 9500),
  opt('[出張設置設定/※初回のみ]プラン2：PC設置、インターネット/メール設定(無線)', 11550, 10500),
  opt('[出張設置設定/※初回のみ]プラン3：2時間フリープラン(PC設置、インターネット/メール設定などPC関連の作業を行うフリープラン)', 18700, 17000),
  opt('[出張設置設定/※初回のみ]プラン4：お好み設定プラン(5つのオプションからお好きなものを3つ選べる)', 16500, 15000, { isRecommended: true }),
  opt('[出張設置設定/※初回のみ]プラン5：PC買い替えプレミアムパック(データ移行サービス付き(Windows XPから対応))', 31350, 28500, { isRecommended: true }),
]),
],
};

// ============================================================
// 出力
// ============================================================

const btoData = {
product: {
name: 'G-Tune FZ-I9G90',
sku: 'FZI9G90G8BFDW104DEC',
base_price_incl_tax: 1089800,
base_price_excl_tax: 990728,
version: '2026-04-02-v1',
},
hardware_config: hardwareConfig,
peripheral_config: peripheralConfig,
service_config: serviceConfig,
};

// 出力先ディレクトリを作成
const outDir = path.join(__dirname, '..', 'bto-configs');
fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'fz-i9g90.json');
fs.writeFileSync(outPath, JSON.stringify(btoData, null, 2) + '\n', 'utf-8');

// 統計
const allSections = [
...hardwareConfig.sections,
...peripheralConfig.sections,
...serviceConfig.sections,
];
const totalOptions = allSections.reduce((sum, s) => sum + (s.options?.length || 0), 0);
const fileSize = fs.statSync(outPath).size;

console.log('Generated:', outPath);
console.log('  Categories:', allSections.length, '(hw:' + hardwareConfig.sections.length, 'periph:' + peripheralConfig.sections.length, 'svc:' + serviceConfig.sections.length + ')');
console.log('  Options:', totalOptions);
console.log('  File size:', (fileSize / 1024).toFixed(1), 'KB');
