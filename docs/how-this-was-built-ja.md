# どのように作ったか：Shopify Hydrogen上のBTO PCコンフィギュレーター

## 1. 概要

本プロジェクトは、**BTO（Build To Order）PCコンフィギュレーター**をShopify Hydrogen上に実装したものです。[Mouse Computer G TUNEコンフィギュレーター](https://www2.mouse-jp.co.jp/cart/spec.asp?PROD=FZI9G90G8BFDW104DEC)をリファレンスとして、カスタム購入フローを完全にShopifyのプラットフォーム上で実現しています。外部の価格計算サービスやカスタムバックエンドは不要です。

**ライブデモストア:** `nobu-note-store.myshopify.com`

### 技術スタック

| レイヤー | 技術 | バージョン |
|---|---|---|
| ストアフロントフレームワーク | Shopify Hydrogen | 2026.1.3 |
| ルーター | React Router | 7.12 |
| カート変換ロジック | Shopify Functions（Rust/WASM） | Functions API 2026-04 |
| データ投入 | Node.js インポートスクリプト | Admin API 2026-04 |
| ストアフロントクエリ | GraphQL | Storefront API 2026-04 |
| ランタイムターゲット | WebAssembly（`wasm32-unknown-unknown`） | — |

**設計の核心原則は「Shopifyの商品カタログが価格の権威」であること**です。選択可能なすべてのオプションは、管理画面で価格が設定された本物のShopify商品バリアントになっています。価格をブラウザの属性やクエリパラメータで渡すことはないため、システムの設計上、改ざんが不可能になっています。

---

## 2. システム全体アーキテクチャ

このシステムは2つのGitリポジトリと3つのランタイム環境にまたがっています。

```
┌─────────────────────────────────────────────────────────────────────┐
│  リポジトリ 1: bto-on-shopify（Hydrogen ストアフロント）             │
│                                                                     │
│  bto-configs/                                                       │
│  └── fz-i9g90.json  ──────────────────────────────────────────────┐ │
│                                                                   │ │
│  scripts/import-bto.cjs                                           │ │
│  └── OAuth → Admin API 2026-04 ────────────────────────────────┐  │ │
│                                                                 │  │ │
│  app/routes/                                                    │  │ │
│  ├── _index.jsx         （G TUNE ブランドトップページ）          │  │ │
│  └── bto.$handle.jsx    （BTO コンフィギュレーター UI）          │  │ │
│                                                                 │  │ │
└─────────────────────────────────────────────────────────────────│──┘ │
                                                                  │    │
┌─────────────────────────────────────────────────────────────────│────┘
│  Shopify プラットフォーム                                         │
│                                                                  │
│  Admin API ◄──────────────────────────────────────────────────── ┘
│  ├── Metaobject: bto_product  （設定JSON + バリアントID）
│  └── 商品: コンポーネント商品（選択肢ごとに1商品）
│                                                                  │
│  Storefront API ◄──────── Hydrogenローダークエリ ─────────────── ┘
│                                                                  │
│  カート ────────────────────────────────────────────────────────── ┐
│  （Function実行前: 52ライン = 1基本 + Nコンポーネント）          │
│                                                                  │
│  Cart Transform Function ─────────────────────────────────────── ┘
│  └── linesMerge → チェックアウト時に1バンドルラインに統合       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  リポジトリ 2: bto-calculator（Shopify App）                         │
│                                                                     │
│  extensions/cart-transformer-bto/                                   │
│  ├── src/cart_transform_run.rs      （Rustロジック）                 │
│  └── src/cart_transform_run.graphql （Functionインプットクエリ）     │
│                                                                     │
│  デプロイ: shopify app deploy                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**データフローの概要:**

```
[JSONコンフィグファイル]
      │
      ▼ node scripts/import-bto.cjs（Admin API）
[Shopify 管理画面]
  ├── Metaobject（bto_product）― 設定JSONを保持
  └── コンポーネント商品（オプションごとに1商品）― 価格・在庫を保持
      │
      ▼ Storefront API（Hydrogenローダー）
[Hydrogen React UI]
  └── ユーザーがオプションを選択 → CartForm.LinesAdd（1基本 + Nコンポーネント）
      │
      ▼ カート
[Shopify カート]  （_bto_bundle_id属性付きの52ライン）
      │
      ▼ Cart Transform Function（Rust/WASM）
[チェックアウト]  （1マージバンドル: "G TUNE FZ-I9G90 カスタム構成"）
```

---

## 3. データモデル

### Metaobject: `bto_product`

各BTOモデルにMetaobjectエントリーが1つあります。Metaobjectタイプはインポートスクリプトが一度だけ作成し、`PUBLIC_READ`に設定することでStorefront APIが認証なしでアクセスできるようになっています。

| フィールド | 型 | 説明 |
|---|---|---|
| `product_name` | `single_line_text_field` | 表示名（例: `G TUNE FZ-I9G90`） |
| `sku` | `single_line_text_field` | SKU / 型番（例: `FZI9G90G8BFDW104DEC`） |
| `base_price` | `number_integer` | 基本価格（税込、JPY）（例: `1089800`） |
| `version` | `single_line_text_field` | 設定バージョン文字列（例: `2026-04-02-v1`） |
| `hardware_config` | `json` | CPU、メモリ、ストレージ、GPU、冷却など |
| `peripheral_config` | `json` | モニター、キーボード、マウス、ヘッドセットなど |
| `service_config` | `json` | OS、オフィスソフト、保証、サポートプランなど |

MetaobjectのhandleはSKUから生成されます。`FZI9G90G8BFDW104DEC` → `fzi9g90g8bfdw104dec` となり、URLパス `/bto/fzi9g90g8bfdw104dec` になります。

### 設定JSONスキーマ

3つの設定フィールド（`hardware_config`、`peripheral_config`、`service_config`）は同じスキーマを使用します。3種類のセクションタイプがサポートされています。

```jsonc
{
  "sections": [
    // タイプ1: fixed — 固定コンポーネント、ユーザーが選択する余地なし
    {
      "name": "CPU",
      "slug": "cpu",
      "type": "fixed",
      "sort_order": 2,
      "fixed_value": "インテル(R) Core(TM) Ultra 9 プロセッサー 285K",
      "lead_time": 4,             // 出荷リードタイム（日数）— product metafield bto.lead_time にも書き込まれる
      "shopify_variant_id": "gid://shopify/ProductVariant/52030945755448"
      // ↑ インポートスクリプトが書き込む
    },

    // タイプ2: single_select — ラジオボタン、1つだけ選択
    {
      "name": "メモリ",
      "slug": "memory",
      "type": "single_select",
      "sort_order": 5,
      "options": [
        {
          "name": "64GB DDR5-5600",
          "price_incl": 0,        // 基本価格からの差分（税込）
          "price_excl": 0,
          "is_default": true,
          "is_recommended": false,
          "lead_time": 4,         // オプションごとのリードタイム（日数）
          "shopify_variant_id": "gid://shopify/ProductVariant/..."
          // ↑ インポートスクリプトが書き込む
        },
        {
          "name": "128GB DDR5-5600",
          "price_incl": 343200,   // +¥343,200 のアップグレード差分
          "price_excl": 312000,
          "is_default": false,
          "is_recommended": true,
          "lead_time": 4,
          "shopify_variant_id": "gid://shopify/ProductVariant/..."
        }
      ]
    },
    // SSD（M.2）— オプションごとに異なるリードタイム
    {
      "name": "SSD (M.2)", "slug": "ssd_m2", "type": "single_select",
      "options": [
        { "name": "2TB NVMe SSD（Gen5）", "price_incl": 0, "is_default": true, "lead_time": 4  },
        { "name": "4TB NVMe SSD（Gen4）", "price_incl": 127600,               "lead_time": 14 },
        { "name": "4TB NVMe SSD TLC",     "price_incl": 190300,               "lead_time": 21 }
      ]
    },

    // タイプ3: multi_select — チェックボックス、0個以上選択
    {
      "name": "周辺機器セット",
      "slug": "peripheral_set",
      "type": "multi_select",
      "sort_order": 1,
      "options": [ ... ]
    }
  ]
}
```

### コンポーネント商品

インポートスクリプトがBTOコンポーネントごとに1つのShopify商品を作成します。これらの商品は単独で閲覧・購入されることを想定していません。Shopifyに価格と在庫の権限を持たせるためだけに存在します。

| 属性 | 値 |
|---|---|
| Handleパターン | `bto-{sku小文字}-{section_slug}`（fixed）または `bto-{sku小文字}-{section_slug}-{option_index}`（select） |
| タイトル | `[BTO部品] {セクション名}: {オプション名}` |
| 価格 | `option.price_incl`（fixedコンポーネントとデフォルトオプションは¥0） |
| ステータス | `ACTIVE` |
| タグ | `bto-component`、`bto-base:g-tune-fz-i9g90`、`bto-section:{slug}`、`bto-fixed`または`bto-upgrade` |
| 在庫 | トラッキング済み（`inventoryManagement: SHOPIFY`、`inventoryPolicy: DENY`） |
| 公開先 | オンラインストア + Hydrogenストアフロント（Storefront API可視性に必須） |

### データリレーション図

```
bto-configs/fz-i9g90.json
  │
  ├── hardware_config.sections[]
  │     ├── [fixed]         ──────────► Shopify商品（¥0、在庫トラッキング）
  │     │                                  ▲ shopify_variant_idが書き戻される
  │     ├── [single_select]
  │     │     └── options[]  ──────────► オプションごとにShopify商品（価格=差分）
  │     │                                  ▲ shopify_variant_idが書き戻される
  │     └── [multi_select]
  │           └── options[]  ──────────► オプションごとにShopify商品
  │
  ├── peripheral_config.sections[] ──► 同様のパターン
  └── service_config.sections[]   ──► 同様のパターン
         │
         ▼ metaobjectにupsert
  Shopify Metaobject（bto_product）
    └── 設定JSONがすべてのshopify_variant_id値を含む
         │
         ▼ クエリされる
  Hydrogenストアフロント（Storefront API）
    └── metaobjectフィールド → JSONパース → UI描画 → CartForm
```

---

## 4. インポートスクリプト（`scripts/import-bto.cjs`）

### 目的と概要

インポートスクリプトはShopifyにコンフィギュレーターが必要とするすべてのデータを投入するための、一度だけ実行するNode.jsスクリプトです。開発者がローカルで実行し、OAuth認証のためにブラウザを開いた後、Admin APIに直接アクセスします。

### 認証：OAuthフロー

```
開発者ターミナル               ブラウザ                    Shopify
     │                          │                              │
     │  node scripts/import-bto.cjs                            │
     │─────────────────────────►│                              │
     │                          │                              │
     │  HTTPサーバー on :3100    │                              │
     │  ブラウザを自動オープン    │                              │
     │                          │  GET /oauth/authorize        │
     │                          │─────────────────────────────►│
     │                          │                              │
     │                          │  マーチャントがアプリを承認    │
     │                          │◄─────────────────────────────│
     │                          │                              │
     │  GET /auth/callback?code=...                            │
     │◄─────────────────────────│                              │
     │                          │                              │
     │  POST /admin/oauth/access_token                         │
     │─────────────────────────────────────────────────────── ►│
     │                          │                              │
     │  { access_token: "..." } │                              │
     │◄────────────────────────────────────────────────────── ─│
     │                          │                              │
     │  runImport(accessToken)  │                              │
     │  → Admin GraphQL APIコール                              │
```

### ステップバイステップの実行内容

**ステップ1: Metaobject定義の作成**

`metaobjectDefinitionCreate`を呼び出し、`bto_product`タイプとすべてのフィールド定義を登録します。タイプが既に存在する場合は`already exists`エラーを検出してスキップします。

**ステップ1b: `bto.lead_time` メタフィールド定義の作成**

`metafieldDefinitionCreate`を呼び出し、`namespace: "bto"`、`key: "lead_time"`、`type: "number_integer"`、`ownerType: PRODUCT`でメタフィールド定義を作成します。定義が既に存在する場合は`TAKEN`ユーザーエラーを検出してスキップします。この定義があることで、Shopify Admin の商品ページの「メタフィールド」セクションに`lead_time`値が表示されるようになります。

**ステップ2: コンポーネント商品の作成**

3つの設定グループ（`hardware_config`、`peripheral_config`、`service_config`）の各セクションについて:

- `fixed`セクション: `productCreate`で1商品を作成、価格`¥0`、タグに`bto-fixed`を含める
- `single_select` / `multi_select`セクション: オプションごとに1商品、価格は`option.price_incl`に設定

商品作成はべき等です。まず`getProductByHandle`で確認し、既存商品があれば公開とタイトル更新のみ行い、再作成しません。

バリアントの価格と在庫は別途`productVariantsBulkUpdate`で設定します（Admin API 2026-04バージョンでは`ProductCreateInput`にバリアントフィールドをインラインで含められないため）。

価格・在庫設定後、`productUpdate`で`metafields: [{namespace: "bto", key: "lead_time", value: String(leadTime), type: "number_integer"}]`を渡し、リードタイムをメタフィールドに書き込みます。新規・既存商品ともに毎回実行されます。

**ステップ3: セールスチャネルへの公開**

各コンポーネント商品に対して`publishablePublish`を呼び出し、以下に公開します:
- `gid://shopify/Publication/247009149240` — オンラインストア
- `gid://shopify/Publication/294215582008` — Hydrogenストアフロント

このステップは重要です。公開されていない商品は、Storefront APIがカートに追加する際に無言でバリアントをドロップしてしまいます。

**ステップ4: `shopify_variant_id`をJSONに書き戻す**

各商品が作成または検索された後、そのバリアントIDをインメモリの設定オブジェクトに直接パッチします。

```js
// fixedセクション
section.shopify_variant_id = variantId;

// selectオプション
option.shopify_variant_id = variantId;
```

**ステップ5: Metaobjectのupsert**

`metaobjectUpsert`で、バリアントIDを含む充実した設定JSONと共にMetaobjectを作成または更新します。MetaobjectのhandleはSKUから導出します。`FZI9G90G8BFDW104DEC` → `fzi9g90g8bfdw104dec`

**ステップ6: 更新済みJSONをディスクに保存**

充実したJSONを`bto-configs/fz-i9g90.json`に書き戻します。次回実行時にスクリプトはhandleで商品を検索し、作成をスキップして公開とタイトル更新のみ行います。

### 必要なAPIスコープ

| スコープ | 用途 |
|---|---|
| `read_metaobject_definitions` | 定義が既に存在するかチェック |
| `write_metaobject_definitions` | `bto_product`定義を作成 |
| `read_metaobjects` | 厳密には不要だが、グッドプラクティス |
| `write_metaobjects` | `metaobjectUpsert`呼び出し |
| `read_products` | `productByIdentifier`ルックアップ（べき等性チェック） |
| `write_products` | `productCreate`、`productVariantsBulkUpdate`、`productUpdate` |
| `read_publications` | READMEに記載、スクリプトでは厳密には不要 |
| `write_publications` | `publishablePublish`呼び出し — Storefront API可視性に必須 |

### Admin APIオペレーション一覧

| オペレーション | 種別 | 用途 |
|---|---|---|
| `metaobjectDefinitionCreate` | mutation | `bto_product`タイプを登録（ストアごとに1回） |
| `metafieldDefinitionCreate` | mutation | `bto.lead_time` product metafield定義を作成（ストアごとに1回） |
| `metaobjectUpsert` | mutation | BTO設定エントリーを作成または更新 |
| `productByIdentifier(identifier: {handle})` | query | べき等性チェック（商品作成前） |
| `productCreate` | mutation | コンポーネント商品シェルを作成 |
| `productVariantsBulkUpdate` | mutation | 自動作成されたデフォルトバリアントに価格・在庫を設定 |
| `productUpdate` | mutation | 再実行時にタイトル更新 + 毎回 `bto.lead_time` metafield を設定 |
| `publishablePublish` | mutation | オンラインストア + Hydrogenセールスチャネルに公開 |

### `nobu-note-store.myshopify.com`のパブリケーションID

| チャネル | パブリケーションID |
|---|---|
| オンラインストア | `gid://shopify/Publication/247009149240` |
| Hydrogenストアフロント | `gid://shopify/Publication/294215582008` |

別のストアのパブリケーションIDを取得するには、Admin GraphQL APIエクスプローラーで以下を実行します。

```graphql
{ publications(first: 10) { nodes { id name } } }
```

---

## 5. Hydrogenストアフロント

### トップページ（`app/routes/_index.jsx`）

トップページはMouse ComputerのゲーミングPCラインナップを参考にしたG TUNEブランドページを描画します。静的な商品ラインナップデータとShopifyのライブ価格データを組み合わせています。

**Storefrontクエリ:** アクティブな商品ごとにエイリアス付き`product(handle:)`クエリを1つ実行し、`priceRange.minVariantPrice`と`featuredImage`を取得します。現在`GTUNE_LINEUP`でアクティブになっているのはFZ-I9G90のみです。

**描画内容:**
- G TUNEロゴとタグライン付きのヒーローバナー（赤/黒のゲーミングブランドスタイリング）
- カテゴリフィルタータブ: すべて / デスクトップPC / ノートPC（クライアントサイドのstate、サーバーラウンドトリップなし）
- 商品グリッド — アクティブなモデルは`/bto/{btoHandle}`にリンク、非アクティブなモデルは「近日公開」を表示

### BTOコンフィギュレーターページ（`app/routes/bto.$handle.jsx`）

**URLパターン:** `/bto/:handle` — 例: `/bto/fzi9g90g8bfdw104dec`

#### ローダーのデータフロー

```
params.handle = "fzi9g90g8bfdw104dec"
     │
     ├──► BTO_QUERY: metaobject(handle: {type: "bto_product", handle})
     │      cache: CacheNone()  ← importの直後に反映させるためキャッシュなし
     │      └── 返却: handle, type, fields[]{key, value}
     │            └── フィールドをパース: productName, sku, basePrice,
     │                hardware_config, peripheral_config, service_config
     │                （各セクション・オプションにはlead_time: numberが含まれる）
     │
     ├──► PRODUCT_VARIANT_QUERY: product(handle: "g-tune-fz-i9g90")
     │      └── 返却: id, featuredImage, variants.nodes[0].id
     │
     ├──► VARIANTS_AVAILABILITY_QUERY: nodes(ids: [...全バリアントID...])
     │      └── 返却: バリアントごとの { id, availableForSale }
     │      └── 保存形式: availabilityMap { variantId: boolean }
     │
     └──► cart.get()
            └── このhandleの既存BTOバンドルを検索 → savedSelectionsを復元（編集モード）
```

4つのクエリはローダー内で順番に実行されます。metaobjectクエリに`CacheNone()`を使用するのは、`lead_time`値がimport実行のたびに変わるため、CDN/Workerキャッシュの遅延なしに即座に反映する必要があるためです。

#### コンポーネントのstate

```
initialSelections = {
  [section.slug]: defaultOptionIndex   // single_selectの場合
  [section.slug]: []                   // multi_selectの場合
}
```

`selections`は`useState`で管理されます。価格と出荷予定日は`useMemo`を使ってレンダリングごとに再計算されます。

```js
totalPrice = basePrice
           + Σ single_selectオプション[選択済み].price_incl
           + Σ multi_selectオプション[選択済み].price_incl

maxLeadTime = max(
  fixedセクション:         section.lead_time ?? 4,
  single_select選択中:     options[選択済み].lead_time ?? 4,
  multi_selectチェック済み: options[チェック済み].lead_time ?? 4
)

shipDateLabel = format(今日 + maxLeadTime日, "YYYY/MM/DD")
```

`shipDateLabel`は`useEffect`で`localStorage.lastBtoShipDate`にも保存されます。これにより、Cart Transform Functionが属性を転送していない場合でも、カートの`MergedBTOLineItem`がフォールバックとして出荷予定日を表示できます。

#### 在庫チェック

CartFormが送信される前に`checkInventory()`が現在の選択内容を走査し、在庫切れのアイテム（`availabilityMap[variantId] === false`）のリストを返します。存在する場合、デフォルトのフォームアクションがキャンセルされ、代わりに在庫切れダイアログが表示されます。

デフォルト以外の`single_select`アップグレードとすべての`multi_select`選択のみチェックします。fixedコンポーネントとデフォルトオプションは除外されます（標準構成の一部であり、常に在庫があることが期待されるため）。

#### カートラインの構築

`buildCartLines()`は送信時（レンダリング時ではない）に実行され、毎回新しい`crypto.randomUUID()`バンドルIDを生成します。

```
1つのBTO設定で追加されるカートライン:

┌─────────────────────────────────────────────────────────────────────┐
│  ライン 1: 基本商品                                                  │
│    merchandiseId: variantId（g-tune-fz-i9g90のデフォルトバリアント） │
│    quantity: 1                                                      │
│    attributes:                                                      │
│      _bto_bundle_id  = "550e8400-e29b-41d4-a716-446655440000"       │
│      _bto_role       = "base"                                       │
│      _bto_product    = "G TUNE FZ-I9G90"                           │
│      _bto_handle     = "fzi9g90g8bfdw104dec"  （編集リンク用）      │
│      _bto_selections = "{\"os\":1,\"memory\":2,...}"  （編集復元用） │
│      _bto_ship_date  = "2026/04/22"  （今日 + maxLeadTime日）       │
│      _bto_upgrades   = "メモリ: 128GB DDR5 / GPU: RTX 5090 OC"     │
├─────────────────────────────────────────────────────────────────────┤
│  ライン 2: CPU（fixedコンポーネント）                                │
│    merchandiseId: section.shopify_variant_id                        │
│    attributes: _bto_bundle_id（同じ）, _bto_role="component"       │
├─────────────────────────────────────────────────────────────────────┤
│  ライン 3: 選択済みOSオプション                                      │
│    merchandiseId: option.shopify_variant_id                         │
│    attributes: _bto_bundle_id（同じ）, _bto_role="component"       │
├─────────────────────────────────────────────────────────────────────┤
│  ...                                                                │
│  ライン N: 最後のコンポーネント                                      │
└─────────────────────────────────────────────────────────────────────┘
  合計: 1基本 +（fixedセクション数）+（選択済みオプション数）
```

#### CartForm

```jsx
<CartForm
  route="/cart"
  action={CartForm.ACTIONS.LinesAdd}
  inputs={{lines: buildCartLines()}}
>
  {(fetcher) => (
    <button type="submit" disabled={fetcher.state !== 'idle'}>
      {fetcher.state !== 'idle' ? '追加中...' : 'カートに追加'}
    </button>
  )}
</CartForm>
```

### カート表示（`app/components/CartMain.jsx`）

CartMainはカートラインの2つの状態を検出します。

```
CartMain ラインの分類:

cart.lines.nodesの全ライン
     │
     ├── parentRelationship.parentがある → スキップ（バンドルの子要素）
     │
     ├── _bto_bundle_idなし かつ _bto_productまたは_bto_upgradesあり
     │     → mergedBtoLines[]（Cart Transform実行後）
     │     → <MergedBTOLineItem>で描画
     │
     ├── _bto_bundle_idあり
     │     → bundleMap[bundleId]（マージ前の生ライン）
     │     → <BTOBundleItem>で描画（基本 + 折りたたみ可能なコンポーネントリスト）
     │
     └── BTOの属性なし
           → nonBtoLines[]
           → <CartLineItem>（通常）で描画
```

**`MergedBTOLineItem`**（Function実行後）: 商品名 + "カスタム構成"、合計価格、`_bto_upgrades`サマリー、📦 出荷予定日バッジを表示します。マージされたラインが`_bto_upgrades`と`_bto_ship_date`を保持しているのは、RustのFunctionが`LinesMergeOperation`の`attributes`フィールドで明示的に転送しているためです。`_bto_ship_date`が存在しない場合（Functionが未再デプロイの場合など）は`localStorage.lastBtoShipDate`にフォールバックします。また、`_bto_handle`を使った「編集」リンクも表示します（フォールバックは`localStorage.lastBtoPath`）。

**`BTOBundleItem`**（Function実行前）: 基本商品をトグルボタン付きで表示し、Nコンポーネントラインを展開/折りたたみできます。`_bto_ship_date`属性から 📦 出荷予定日を、`_bto_handle`属性から「編集」リンクを表示します。「削除」ボタンはすべてのラインID（基本 + 全コンポーネント）を`CartForm.ACTIONS.LinesRemove`に渡します。

---

## 6. カートバンドルアーキテクチャ（重要セクション）

### なぜ属性ではなく実商品を使うのか

単純なBTO実装では、合計価格をカスタム属性として1つのカートラインに追加することが考えられます。しかしこのアプローチには重大なセキュリティ上の問題があります。Storefront APIはクライアントが任意の属性値を設定することを許可しており、`_total_price`などの属性も含まれます。

```
間違ったアプローチ（改ざん可能）:
  カートライン: { price_attr: "1089800", total_price_attr: "1089800" }
  → クライアントが price_attr を任意の値に変更可能

正しいアプローチ（本実装）:
  カートライン: 基本商品（¥1,089,800）+ コンポーネント商品（¥0または差分）
  → 価格はShopify商品バリアントレコードから取得
  → Storefront APIが価格を強制; クライアントの属性では変更不可
```

### バンドルIDのパターン

すべてのBTO設定は送信時にUUIDが生成されます。

```js
const bundleId = crypto.randomUUID();
// 例: "550e8400-e29b-41d4-a716-446655440000"
```

このUUIDはバッチ内のすべてのラインに`_bto_bundle_id`として付与されます。Cart Transform FunctionはこのUUIDでラインをグループ化してバンドルを形成します。

### ライン属性スキーマ

| 属性キー | 値の例 | 付与対象 | 顧客に見えるか |
|---|---|---|---|
| `_bto_bundle_id` | `550e8400-e29b-...` | 全BTOライン | いいえ（アンダースコアプレフィックス） |
| `_bto_role` | `base`または`component` | 全BTOライン | いいえ |
| `_bto_product` | `G TUNE FZ-I9G90` | 基本ラインのみ | いいえ |
| `_bto_handle` | `fzi9g90g8bfdw104dec` | 基本ラインのみ | いいえ（「編集」リンクの生成に使用） |
| `_bto_selections` | `{"os":1,"memory":2,...}` | 基本ラインのみ | いいえ（編集時に選択内容を復元） |
| `_bto_ship_date` | `2026/04/22` | 基本ラインのみ | いいえ（マージ後のラインに転送） |
| `_bto_upgrades` | `メモリ: 128GB / GPU: OC` | 基本ラインのみ | いいえ（マージ後のラインに転送） |
| `_bto_section` | `メモリ` | コンポーネントラインのみ | いいえ |

すべてのキーは`_`で始まります。Shopifyのストアフロントはこれらをプライベートとして扱い、注文確認メールなどで顧客に表示しません。

### カートに追加されるラインの構造

```
例: G TUNE FZ-I9G90（メモリアップグレード + OSアップグレード選択時）
（hardware_configに約15セクション; peripheral_configに約10; service_configに約10）

基本ライン（×1）:
  └── g-tune-fz-i9g90 デフォルトバリアント（¥1,089,800）

固定コンポーネントライン（×N_fixed）:
  ├── bto-fzi9g90g8bfdw104dec-cpu            （¥0）
  ├── bto-fzi9g90g8bfdw104dec-cpu_fan        （¥0）
  ├── bto-fzi9g90g8bfdw104dec-motherboard    （¥0）
  └── ...（全fixedセクション）

Single-selectコンポーネントライン（×N_single_select）:
  ├── bto-fzi9g90g8bfdw104dec-os-1           （¥8,800  ← Windows Proアップグレード）
  ├── bto-fzi9g90g8bfdw104dec-memory-1       （¥343,200 ← 128GBアップグレード）
  └── ...（各セクションで選択されたオプション）

Multi-selectコンポーネントライン（×N_multi_select_selected）:
  └── ...（ユーザーがチェックした場合のみ）

合計: 典型的なデスクトップ設定で40〜52カートライン
```

---

## 7. Cart Transform Function（`bto-calculator/`）

### Shopifyアプリのセットアップ

Cart Transform FunctionはShopifyアプリ（`bto-calculator/`）として別個に存在します。Hydrogenストアフロントと同じストアにデプロイする必要があります。デプロイ後、`cartTransformCreate` Admin API mutationでアクティベートします。

FunctionターゲットはFunctions API `2026-04`の`cart.transform.run`です。

### インプットクエリ

Functionインプットクエリは必要な属性だけを取得します。クエリを最小限に保つことでWASM実行コストが削減されます。

```graphql
query CartTransformRunInput {
  cart {
    lines {
      id
      quantity
      bundleId: attribute(key: "_bto_bundle_id") {
        value
      }
      role: attribute(key: "_bto_role") {
        value
      }
      productName: attribute(key: "_bto_product") {
        value
      }
      upgrades: attribute(key: "_bto_upgrades") {
        value
      }
      shipDate: attribute(key: "_bto_ship_date") {
        value
      }
      merchandise {
        __typename
        ... on ProductVariant {
          id
        }
      }
    }
  }
}
```

### アルゴリズム（フローチャート）

```
FUNCTION: cart_transform_run(input)

  groups = HashMap<bundle_id, (base_idx: Option<usize>, component_indices: Vec<usize>)>

  各ラインをインデックスiで反復:
    IF ラインに_bto_bundle_idなし → SKIP（非BTOライン、そのまま通過）
    
    bundle_id = line._bto_bundle_id
    
    IF line._bto_role == "base":
      groups[bundle_id].base_idx = Some(i)
    ELSE:
      groups[bundle_id].component_indices.push(i)

  operations = []

  各(bundle_id, (base_idx_opt, component_indices))を反復:
    IF base_idx_optがNone → SKIP（不正なバンドル）
    IF component_indicesが空 → SKIP（マージするものなし）
    
    base_line = lines[base_idx]
    parent_variant_id = base_line.merchandise.id
    product_name = base_line._bto_product または "G TUNE"
    title = "{product_name} カスタム構成"
    
    IF base_lineに_bto_upgradesあり:
      attributes = [{ key: "_bto_upgrades", value: upgrades_value }]
    
    cart_lines = [base_line_id] + [各コンポーネントのcomponent_line_id]
    
    operations.push(LinesMerge {
      cart_lines,
      parent_variant_id,   ← 基本商品バリアント（画像・タイトルフォールバック用）
      title,
      price: None,         ← 価格は上書きしない; コンポーネント価格の合計が使われる
      attributes,          ← カート表示用に_bto_upgradesを転送
    })

  RETURN { operations }
```

### `linesMerge`が行うこと

```
Cart Transform Function実行前:

  カートライン（計52本）:
  ┌──────────────────────────────────────────────────────┐
  │ ライン 1:  g-tune-fz-i9g90 （¥1,089,800） [base]    │
  │ ライン 2:  bto-...-os-0    （¥0）          [comp]    │
  │ ライン 3:  bto-...-cpu     （¥0）          [comp]    │
  │ ライン 4:  bto-...-cpu_fan （¥0）          [comp]    │
  │ ...                                                  │
  │ ライン 52: bto-...-warranty-1 （¥5,500）   [comp]    │
  └──────────────────────────────────────────────────────┘

Cart Transform Function実行後（チェックアウト時）:

  カートライン（計1本）:
  ┌──────────────────────────────────────────────────────┐
  │ バンドル: "G TUNE FZ-I9G90 カスタム構成"             │
  │   parentVariantId: g-tune-fz-i9g90バリアント         │
  │   price: 全52コンポーネント価格の合計                │
  │   attributes: { _bto_upgrades: "メモリ: 128GB / ..." }│
  └──────────────────────────────────────────────────────┘
```

`LinesMergeOperation`の`price: None`フィールドは意図的なものです。価格を指定しないことで、Shopifyはバンドル価格を含まれるすべてのラインの価格の合計として計算します。これにより、改ざん防止の価格設定が維持されます。

### デプロイ手順

```bash
cd bto-calculator
pnpm install
pnpm run build     # Rust → wasm32-unknown-unknownにコンパイル
shopify app deploy # WASMをShopifyにアップロード、Functionをアクティベート
```

デプロイ後、Functionはストアのすべてのカートに自動的に適用されます。

---

## 8. セキュリティ設計

### 価格の権威性

このシステムの基本的なセキュリティ特性は、**価格の権威性が完全にShopifyの商品カタログに属している**ことです。

```
クライアントブラウザ              Shopify
     │                              │
     │  CartForm.LinesAdd            │
     │  （属性に価格なし）            │
     │────────────────────────────► │
     │                              │
     │                         Shopifyが検証:
     │                         - 各merchandiseIdが存在するか
     │                         - 商品バリアントレコードから価格を取得
     │                         - 属性では価格を上書きできない
     │                              │
     │  カートレスポンス（価格設定済み）│
     │◄─────────────────────────────│
```

ユーザーがCartFormの送信をインターセプトして`_bto_total_price=1`属性を追加しても、Shopifyはそれを無視します。カートラインの価格は常に商品バリアントのpriceフィールドから取得されます。

### 公開要件

コンポーネント商品はHydrogen ストアフロントのセールスチャネルに公開されている必要があります。商品が未公開の場合:

- Storefront APIは`LinesAdd` mutationを無言で受け付ける
- 未公開のバリアントIDが結果のカートから無言でドロップされる
- エラーなしでカートのアイテムが予期より少ない状態になる

これが、インポートスクリプトで`publishablePublish`が必須ステップである理由であり、`read_publications` / `write_publications`スコープが必要な理由です。

### 在庫チェック

ローダーは1回の`nodes(ids: [...])`クエリですべてのコンポーネントバリアントの`availableForSale`を取得します。これはカート送信を許可する前にクライアントサイドでチェックされます。ただし、権威ある在庫チェックはShopifyが`LinesAdd`を処理するサーバーサイドで行われます。クライアントサイドのチェックはUXのみを目的としています（チェックアウトで驚かれる前に在庫切れダイアログを表示するため）。

---

## 9. ユーザーフロー（エンドツーエンドシーケンス図）

```
顧客                     Hydrogen（SSR）          Shopify APIs
    │                         │                        │
    │  GET /                  │                        │
    │────────────────────────►│                        │
    │                         │  Storefront: 商品取得  │
    │                         │───────────────────────►│
    │                         │◄───────────────────────│
    │  G TUNEブランドページ    │                        │
    │◄────────────────────────│                        │
    │                         │                        │
    │  FZ-I9G90をクリック      │                        │
    │────────────────────────►│                        │
    │                         │  Storefront:           │
    │                         │  metaobject + 商品     │
    │                         │  + バリアント在庫       │
    │                         │───────────────────────►│
    │                         │◄───────────────────────│
    │  BTOコンフィギュレーター  │                        │
    │◄────────────────────────│                        │
    │                         │                        │
    │  オプションを選択        │                        │
    │  （クライアントサイドstate）                       │
    │  ライブ価格を確認        │                        │
    │                         │                        │
    │  「カートに追加」クリック │                        │
    │  （在庫チェック: OK）    │                        │
    │────────────────────────►│  CartForm.LinesAdd     │
    │                         │  （52ライン + bundle_id）│
    │                         │───────────────────────►│
    │                         │◄───────────────────────│
    │  カートサイドバー表示    │                        │
    │  （BTOBundleItem: 基本   │                        │
    │   + Nコンポーネントライン）                        │
    │◄────────────────────────│                        │
    │                         │                        │
    │  「Checkout」クリック    │                        │
    │                         │  Cart Transform実行    │
    │                         │  （Rust/WASM Function）│
    │                         │  52ライン → 1バンドル  │
    │                         │───────────────────────►│
    │                         │                        │
    │  チェックアウトページ    │                        │
    │  "G TUNE FZ-I9G90       │                        │
    │   カスタム構成"          │                        │
    │  （1ライン、正確な合計）  │                        │
    │◄────────────────────────│                        │
    │                         │                        │
    │  決済完了               │                        │
    │────────────────────────────────────────────────►│
    │                         │                        │
    │                         │        注文作成         │
    │                         │        コンポーネントごと│
    │                         │        の在庫が減少     │
```

---

## 10. APIリファレンス

### Admin GraphQLオペレーション（インポートスクリプト）

| オペレーション | 種別 | APIバージョン | 用途 |
|---|---|---|---|
| `metaobjectDefinitionCreate` | mutation | 2026-04 | `bto_product`タイプを登録 |
| `metaobjectUpsert` | mutation | 2026-04 | BTO設定エントリーを作成または更新 |
| `productByIdentifier(identifier: {handle})` | query | 2026-04 | べき等性チェック |
| `productCreate` | mutation | 2026-04 | コンポーネント商品シェルを作成 |
| `productVariantsBulkUpdate` | mutation | 2026-04 | 価格・在庫を設定 |
| `productUpdate` | mutation | 2026-04 | 再実行時にタイトルを更新 |
| `publishablePublish` | mutation | 2026-04 | セールスチャネルに公開 |

### Storefront APIクエリ（Hydrogenルート）

| クエリ | ファイル | 用途 |
|---|---|---|
| `product(handle:)`（エイリアス付き） | `_index.jsx` | ブランドページ用の基本商品画像・価格 |
| `metaobject(handle: {type, handle})` | `bto.$handle.jsx` | 完全なBTO設定JSON |
| `product(handle: "g-tune-fz-i9g90")` | `bto.$handle.jsx` | 基本商品バリアントID + featuredImage |
| `nodes(ids: [...])`（`ProductVariant`インラインフラグメント付き） | `bto.$handle.jsx` | バルク在庫チェック |

### Cart Transform Functionインプットフィールド

| GraphQLエイリアス | キー | 用途 |
|---|---|---|
| `bundleId` | `_bto_bundle_id` | ラインを1つのバンドルにグループ化 |
| `role` | `_bto_role` | 基本とコンポーネントを識別 |
| `productName` | `_bto_product` | バンドルの表示タイトル |
| `upgrades` | `_bto_upgrades` | カート表示用にマージバンドルへ転送 |
| `merchandise { ... on ProductVariant { id } }` | — | `linesMerge`用の`parentVariantId` |

### Shopify Functions API

| プロパティ | 値 |
|---|---|
| APIバージョン | `2026-04` |
| ターゲット | `cart.transform.run` |
| ランタイム | WebAssembly（`wasm32-unknown-unknown`） |
| 言語 | Rust（`shopify_function`クレート経由） |
| インプットサイズ上限 | 約64KB（典型的なBTOカートには十分） |
| アクティベーション | `shopify app deploy`後に`cartTransformCreate` mutation |

---

## 11. 新しいBTOモデルの追加方法

以下の手順で新しいBTOモデルをストアに追加します。

**ステップ1: 設定JSONを作成する**

```bash
cp bto-configs/fz-i9g90.json bto-configs/new-model.json
# new-model.jsonを編集:
#   - product.name, product.sku, product.base_price_incl_taxを更新
#   - product.versionを更新
#   - 全セクションを新モデルの設定に置き換える
#   - shopify_variant_idフィールドをすべて削除（インポートスクリプトが記入する）
```

JSONの構造はセクション3のスキーマに従う必要があります。`shopify_variant_id`フィールドは存在しないか空にしてください。インポートスクリプトが書き込みます。

**ステップ2: インポートスクリプトを新ファイルを読むように更新する**

現在`import-bto.cjs`は`fz-i9g90.json`をハードコードしています。新しいモデルの場合:
- `runImport()`内の`jsonPath`変数を更新する、または
- ファイル名をコマンドライン引数にする

**ステップ3: インポートスクリプトを実行する**

```bash
# .envに必要なクレデンシャルが設定されていることを確認
node scripts/import-bto.cjs

# スクリプトは以下を実行します:
# 1. OAuthのためにブラウザを開く
# 2. コンポーネント商品を作成（典型的なデスクトップ設定で約40〜52商品）
# 3. shopify_variant_idをJSONに書き戻す
# 4. bto_product metaobjectをupsertする
# 5. 充実したJSONをディスクに保存する
```

**ステップ4: Shopify管理画面で確認する**

- **商品** → `bto-component`タグが付いた新しいコンポーネント商品があることを確認
- **コンテンツ → Metaobjects → BTO Product** → 新しいエントリーがあることを確認

**ステップ5: Hydrogenラインナップに追加する**

`app/routes/_index.jsx`の`GTUNE_LINEUP`にエントリーを追加します。

```js
{
  handle: 'new-model-shopify-handle',
  name: 'G TUNE NEW-MODEL',
  category: 'desktop',   // または 'note'
  tag: 'ミドルレンジ',
  description: '...',
  btoHandle: 'new-model-sku-lowercase',  // metaobjectのhandleと一致させる
  active: true,
},
```

また、価格データが読み込まれるよう`GTUNE_PRODUCTS_QUERY`にも商品を追加します。

```graphql
newmodel: product(handle: "new-model-shopify-handle") {
  id
  handle
  title
  priceRange { minVariantPrice { amount currencyCode } }
  featuredImage { id url altText width height }
}
```

**ステップ6: コンフィギュレーターをテストする**

```bash
npm run dev
# 確認: http://localhost:3000/bto/<new-model-sku-lowercase>
```

以下を確認します:
- 全セクションが描画されている（fixed、single_select、multi_select）
- オプション選択に応じて価格が更新される
- 「カートに追加」でカートにラインが追加される

**ステップ7: Cart Transform Functionをデプロイする**

既存のCart Transform Functionは任意の`_bto_bundle_id`グループに対して機能します。Function自体の変更は不要です。既にデプロイ済みであることを確認するだけです。

```bash
cd bto-calculator
pnpm run build
shopify app deploy
```

---

## 12. 既知の制限と今後の課題

### 現在の制限

**`linesMerge`はShopify Plusまたは開発ストアが必要**

52ラインをチェックアウト時に1バンドルに統合する`linesMerge` Cart Transformオペレーションは、Shopify Plusプランと開発ストアでのみ利用可能です。標準プランではFunctionは実行されますが、`linesMerge`オペレーションは無言で無視され、チェックアウトに52本の個別ラインが表示されます。

**ストアあたりのCart Transformは1つのみ**

Shopifyでは一度にアクティブなCart Transformは1つのみです。ストアが既に別の目的でCart Transformを使用している場合（例: ボリュームディスカウントバンドラー）、ロジックを1つのFunctionに統合しない限り、BTOのFunctionと共存できません。

**デフォルト・固定コンポーネントの在庫は¥0でトラッキング**

fixedセクションとデフォルトオプションは¥0で価格設定されています。Shopifyで在庫がトラッキングされますが、¥0の商品は管理画面の商品リストに表示され、BTOアーキテクチャを知らないストア担当者を混乱させる可能性があります。

**Cart Transform実行前はカートに52ラインが表示される**

Cart Transform Functionはカートに商品が追加されたときではなく、チェックアウト時に実行されます。HydrogenカートサイドバーではユーザーはBTOBundleItemによって視覚的にグループ化された生の52ラインを見ますが、それでも個別に削除できます。「Checkout」クリック後にFunctionがマージします。

**インポートスクリプトが1つの設定ファイルをハードコード**

`scripts/import-bto.cjs`は現在`bto-configs/fz-i9g90.json`をハードコードしています。複数モデルの追加にはスクリプトの編集またはCLI引数のサポートが必要です。

**BTOコンフィギュレーターページの基本商品ハンドルがハードコード**

`bto.$handle.jsx`のローダーでは基本商品クエリのハンドルが`handle: 'g-tune-fz-i9g90'`とハードコードされています。新しいBTOモデルごとに独自の基本商品ハンドルが必要であり、ハードコードではなくmetaobjectに保存するのが理想的です。

### 今後の課題

- ローダーのハードコードされた商品ハンドルを排除するため、`bto_product` metaobjectにShopify基本商品ハンドルのフィールドを追加する
- CLIアーキュメントによる複数設定ファイルのサポートをインポートスクリプトに追加する
- `cartTransformCreate`の自動化ステップをインポートスクリプトに追加して、新しいデプロイが完全に自己完結するようにする
- 構成の比較機能を追加する（選択済みオプションのサイドバイサイド差分表示）
- チェックアウト間の在庫チェックと過剰販売を防ぐサーバーサイドの在庫予約を実装する
- metaobjectが更新された後も古い注文が正しい仕様を表示し続けられるよう、metafieldベースの設定バージョニングを追加する
