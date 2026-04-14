# BTO on Shopify — Hydrogen

[Shopify Hydrogen](https://shopify.dev/docs/storefronts/headless/hydrogen)（v2026.1.3）上に構築した BTO（Build To Order）PC コンフィギュレーターです。[Mouse Computer G TUNE コンフィギュレーター](https://www2.mouse-jp.co.jp/cart/spec.asp?PROD=FZI9G90G8BFDW104DEC)をリファレンスモデルとしています。

**ライブデモストア:** `nobu-note-store.myshopify.com`

---

## 仕組み

### アーキテクチャ概要

```
bto-configs/fz-i9g90.json
  └── scripts/import-bto.cjs (Admin GraphQL API 2026-04)
        ├── Metaobject を作成: bto_product（設定 JSON + バリアント ID）
        └── コンポーネント Shopify 商品を作成（選択肢ごとに 1 商品）

Hydrogen ストアフロント（Storefront API 2026-04）
  ├── /（トップページ）→ 基本商品の画像・価格を取得 → G TUNE ブランドページ
  └── /bto/:handle    → bto_product メタオブジェクトを取得 → BTO コンフィギュレーター UI
        └── カートに反映 → CartForm（LinesAdd）
              ├── 基本商品ライン × 1   (_bto_role=base,      _bto_bundle_id=<uuid>)
              └── コンポーネントライン × N (_bto_role=component, _bto_bundle_id=<uuid>)

bto-calculator/（Shopify App — Functions API 2026-04）
  └── Cart Transform Function（Rust/WASM）
        └── _bto_bundle_id でラインをグループ化 → linesMerge → チェックアウト時に 1 バンドルへ統合
```

**価格の整合性:** コンポーネント商品の価格は Shopify で設定されており、クライアントから変更できません。価格値をカート属性として渡すことはありません。

---

## データモデル

### メタオブジェクト: `bto_product`

各 BTO モデルの設定全体（選択可能なすべてのオプションと、インポートスクリプトが書き戻した `shopify_variant_id`）を格納します。

| フィールド | 型 | 説明 |
|---|---|---|
| `product_name` | single_line_text | 表示名（例: `G TUNE FZ-I9G90`） |
| `sku` | single_line_text | 商品 SKU / 設定コード |
| `base_price` | number_integer | ベース価格（税込・円） |
| `version` | single_line_text | 設定バージョン文字列 |
| `hardware_config` | json | CPU・メモリ・ストレージ・GPU など |
| `peripheral_config` | json | モニター・キーボード・マウスなど |
| `service_config` | json | OS・オフィスソフト・保証など |

各 JSON 設定は以下のスキーマに従います:

```jsonc
{
  "sections": [
    {
      "name": "CPU",
      "slug": "cpu",
      "type": "fixed",           // fixed | single_select | multi_select
      "sort_order": 1,
      "fixed_value": "Core Ultra 9 285K",
      "shopify_variant_id": "gid://shopify/ProductVariant/..."  // インポートスクリプトが書き込み
    },
    {
      "name": "メモリ",
      "slug": "memory",
      "type": "single_select",
      "sort_order": 3,
      "options": [
        {
          "name": "64GB DDR5",
          "price_incl": 0,        // ベース価格からの税込差額
          "price_excl": 0,
          "is_default": true,
          "is_recommended": false,
          "shopify_variant_id": "gid://shopify/ProductVariant/..."  // インポートスクリプトが書き込み
        },
        {
          "name": "128GB DDR5",
          "price_incl": 343200,
          "price_excl": 312000,
          "is_default": false,
          "is_recommended": true,
          "shopify_variant_id": "gid://shopify/ProductVariant/..."
        }
      ]
    }
  ]
}
```

### コンポーネント商品

インポートスクリプトが BTO コンポーネントごとに Shopify 商品を 1 つ作成します（全セクション種別対象）。これらの商品は:
- `bto-component`、`bto-base:<handle>`、`bto-section:<slug>` のタグが付与される
- 在庫追跡が有効（`inventoryManagement: SHOPIFY`）
- オプションの `price_incl` 差額で価格が設定される（デフォルト・固定コンポーネントは ¥0）
- ストアフロントのコレクション・一覧から除外される

---

## 主要ファイル

### ルート

#### [`app/routes/_index.jsx`](app/routes/_index.jsx) — G TUNE ブランドトップページ

**Storefront API クエリ:**
- アクティブな商品ごとに `productByIdentifier` エイリアス → 画像・ベース価格を取得

**レンダリング内容:**
- G TUNE ヒーローバナー（赤黒のブランドデザイン）
- カテゴリーフィルタータブ: すべて / デスクトップ PC / ノート PC（クライアントサイド）
- 商品グリッド — FZ-I9G90 は `/bto/fzi9g90g8bfdw104dec` へリンク。他モデルは「近日公開」表示

---

#### [`app/routes/bto.$handle.jsx`](app/routes/bto.$handle.jsx) — BTO コンフィギュレーター

**URL パターン:** `/bto/:handle`（例: `/bto/fzi9g90g8bfdw104dec`）

**Storefront API クエリ（ローダー）:**
1. `metaobject(handle: {type: 'bto_product', handle})` — 設定 JSON 全体（バリアント ID 含む）
2. `product(handle: 'g-tune-fz-i9g90')` — カートの基本ラインに使うベース商品バリアント ID
3. `cart.get()` — カートに既存の BTO バンドルがあれば選択内容を復元（編集モード）

**レンダリング内容:**
- ハードウェア / 周辺機器 / ソフト・サービス のセクショングループ
- セクションごとのアコーディオン（`BTOCategory`）:
  - `fixed` → 仕様ラベルの静的表示
  - `single_select` → ラジオグループ
  - `multi_select` → チェックボックスグループ
- スティッキーサイドバー: リアルタイム価格（ベース＋オプション差額）、カートボタン
- **編集モード:** カートに同一モデルのバンドルがある場合、前回の選択内容を復元して「カートに反映（上書き）」ボタンを表示

**カートに追加 — マルチラインバンドル:**
```jsx
// 全ラインが crypto.randomUUID() で生成した共通バンドル ID を持つ
// カートに反映ボタン押下でカートドロワーが自動的に開く
<CartForm route="/cart" action={CartForm.ACTIONS.LinesAdd} inputs={{lines: buildCartLines()}}>
```

BTO 注文ごとに追加されるライン:
| ライン | `merchandiseId` | 主要属性 |
|---|---|---|
| 基本商品 | `variantId`（ベース PC） | `_bto_bundle_id`、`_bto_role=base`、`_bto_product`、`_bto_handle`、`_bto_selections` |
| 固定コンポーネント × N | `section.shopify_variant_id` | `_bto_bundle_id`、`_bto_role=component`、`_bto_section` |
| 選択オプション × N | `option.shopify_variant_id` | `_bto_bundle_id`、`_bto_role=component`、`_bto_section` |

> `_bto_handle` と `_bto_selections`（選択内容の JSON）を基本ラインに保持することで、カートの「編集」ボタンからコンフィギュレーターへ戻った際に選択内容を復元できます。

> **注意:** 価格値は属性として渡しません。価格は Shopify の商品バリアントレコードから取得し、Cart Transform Function によって強制されます。クライアントサイドからの改ざんは不可能です。

---

### カート表示

#### [`app/components/CartMain.jsx`](app/components/CartMain.jsx)
- **ラインの分類:**
  - `_bto_bundle_id` を持つライン → `bundleMap`（変換前バンドル）→ `BTOBundleItem` でレンダリング
  - `_bto_upgrades` を持つが `_bto_bundle_id` を持たないライン → `mergedBtoLines`（Cart Transform 後）→ `MergedBTOLineItem` でレンダリング
  - その他 → `CartLineItem` でレンダリング
- **編集ボタン:** `BTOBundleItem` と `MergedBTOLineItem` それぞれに「編集」リンクを表示。`_bto_handle` 属性、または `localStorage` のフォールバックを使ってコンフィギュレーターへ戻る
- **ローディング状態:** カートミューテーション中は `useFetchers()` を監視してバナースピナーを表示
- **1バンドル制限:** カートアクション（`cart.jsx`）がカートに追加する前にサーバーサイドで既存の BTO ラインをすべて削除。変換前（`_bto_bundle_id`）と変換後（`ComponentizableCartLine` の `lineComponents`）の両方を検出して削除

#### [`app/components/CartLineItem.jsx`](app/components/CartLineItem.jsx)
- `"Default Title"` バリアントラベルを非表示
- 公開ライン属性（`_` プレフィックスなし）を `dt/dd` リストで表示

#### [`app/components/CartSummary.jsx`](app/components/CartSummary.jsx)
- 「合計」・「小計」・割引コード・ギフトカード・「チェックアウトへ進む」ボタンを日本語で表示
- `/cart` ページではウィンドウフォーカス時に `useRevalidator` でカートデータを再取得（チェックアウトページから戻った際のデータ更新）

---

### Cart Transform Function — `bto-calculator/`

`bto-calculator/` にある Shopify アプリに格納されています。

**エクステンション:** `extensions/cart-transformer-bto/`（Rust → WebAssembly）

**ターゲット:** `cart.transform.run`（Functions API `2026-04`）

**インプットクエリ**（カートラインごとに取得）:
- `id`、`quantity`
- `attribute(key: "_bto_bundle_id")` — ラインをバンドルにグループ化
- `attribute(key: "_bto_role")` — 基本ラインとコンポーネントラインを識別
- `attribute(key: "_bto_product")` — バンドル表示名
- `merchandise { ... on ProductVariant { id } }` — `linesMerge` の `parentVariantId` に使用

**ロジック:**
1. 全ラインを `_bto_bundle_id` でグループ化
2. グループごとに基本ラインを特定し、`linesMerge` で全ラインをマージ
3. チェックアウト時の結果: 「G TUNE FZ-I9G90 カスタム構成」という 1 つのバンドルライン
4. BTO 以外のラインはそのまま通過

> **1 バンドル制限について:** `cart.get()` で返される `ComponentizableCartLine`（Cart Transform 実行後）には、サブラインの `_bto_bundle_id` は親ノードに存在しません。`cart.jsx` のカートアクションはこれを `lineComponents != null` で検出し、新しいバンドルを追加する前に削除します。

---

## Shopify アプリの設定（Admin API アクセス）

インポートスクリプトは **Shopify カスタムアプリ**（OAuth）で認証します。Shopify Partner Dashboard またはストア管理画面から作成してください。

### 必要な API スコープ

```
read_metaobject_definitions
write_metaobject_definitions
read_metaobjects
write_metaobjects
read_products
write_products
read_publications
write_publications
```

> `read_publications` / `write_publications` は `publishablePublish` に必要です。これがないとコンポーネント商品は作成されますが、どの販売チャネルにも公開されず、Storefront API がカートへの追加時に無視します。

### セットアップ手順

1. **Shopify 管理画面 → 設定 → アプリと販売チャネル → アプリを開発する** に移動
2. 新しいアプリを作成（例: `bto-importer`）
3. **設定 → Admin API アクセススコープ** に上記スコープをすべて追加
4. ストアにアプリをインストール
5. **クライアント ID** と **クライアントシークレット** を `.env` にコピー:

```bash
SHOPIFY_CLIENT_ID=your_client_id
SHOPIFY_CLIENT_SECRET=your_client_secret
SHOPIFY_STORE_DOMAIN=nobu-note-store.myshopify.com
SHOPIFY_SCOPES=read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_products,write_products,read_publications,write_publications
```

### パブリケーション ID（nobu-note-store.myshopify.com）

インポートスクリプトはコンポーネント商品を以下の 2 つの販売チャネルに公開します（`scripts/import-bto.cjs` にハードコード）:

| パブリケーション | ID |
|---|---|
| Online Store | `gid://shopify/Publication/247009149240` |
| Hydrogen ストアフロント | `gid://shopify/Publication/294215582008` |

> 別のストアのパブリケーション ID を確認するには、Admin GraphQL API で以下を実行してください: `{ publications(first: 10) { nodes { id name } } }`

---

## API リファレンス

### 使用 Shopify API とバージョン

| API | バージョン | 使用箇所 |
|---|---|---|
| Admin GraphQL API | `2026-04` | `scripts/import-bto.cjs` |
| Storefront API | Hydrogen デフォルト（`2026-04`）| `app/routes/*.jsx` |
| Functions API | `2026-04` | `bto-calculator/` Cart Transform |

### Admin GraphQL ミューテーション・クエリ（`scripts/import-bto.cjs`）

| オペレーション | 種別 | 目的 |
|---|---|---|
| `metaobjectDefinitionCreate` | mutation | `bto_product` メタオブジェクト定義を作成（初回のみ）|
| `metaobjectUpsert` | mutation | BTO 設定メタオブジェクトエントリを作成・更新 |
| `productByIdentifier(identifier: {handle})` | query | コンポーネント商品が既に存在するか確認 |
| `productCreate(product: ProductCreateInput)` | mutation | コンポーネント商品の雛形を作成 |
| `productVariantsBulkUpdate` | mutation | デフォルトバリアントの価格・在庫追跡を設定 |

### Storefront API クエリ（`app/routes/`）

| クエリ | ファイル | 目的 |
|---|---|---|
| `productByIdentifier` エイリアス経由 `product(handle:)` | `_index.jsx` | ブランドページ用に基本商品の画像・価格を取得 |
| `metaobject(handle: {type, handle})` | `bto.$handle.jsx` | BTO 設定 JSON を取得 |
| `product(handle:)` | `bto.$handle.jsx` | カート用に基本商品バリアント ID を取得 |
| `cart.get()` | `bto.$handle.jsx` | 編集モード復元用に既存の BTO バンドルを確認 |

### Functions API — Cart Transform インプットクエリ

| フィールド | パス | 目的 |
|---|---|---|
| `attribute(key: "_bto_bundle_id")` | `cart.lines[]` | ラインを 1 つの BTO バンドルにグループ化 |
| `attribute(key: "_bto_role")` | `cart.lines[]` | 基本ラインとコンポーネントラインを識別 |
| `attribute(key: "_bto_product")` | `cart.lines[]` | バンドルタイトル（商品名） |
| `merchandise { ... on ProductVariant { id } }` | `cart.lines[]` | `linesMerge` の `parentVariantId` |

---

## インポートスクリプト

BTO 設定 JSON ファイルは [`bto-configs/`](bto-configs/) に格納されています。インポートスクリプトがコンフィギュレーターに必要な Shopify 商品とメタオブジェクトをすべて作成します。

```bash
# 1. .env に認証情報を設定
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_STORE_DOMAIN=nobu-note-store.myshopify.com
SHOPIFY_SCOPES=read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_products,write_products

# 2. 実行（ブラウザで OAuth 認証）
node scripts/import-bto.cjs
```

処理内容:
1. ブラウザ経由の OAuth → Shopify アクセストークン取得
2. `bto_product` メタオブジェクト定義を作成（既に存在する場合はスキップ）
3. 設定ファイルごとに: コンポーネント商品を 1 つずつ作成（全セクション種別）
4. オプション・セクションごとに `shopify_variant_id` を設定 JSON に書き戻し
5. 拡充した JSON でメタオブジェクトを Upsert
6. 更新済み JSON をディスクに保存（再実行時は作成済み商品をスキップ）

---

## はじめかた

**前提条件:** Node.js 18+、Rust + `wasm32-unknown-unknown` ターゲット

```bash
npm install
npm run dev        # Hydrogen 開発サーバーを起動
npm run build      # 本番ビルド
npm run codegen    # クエリ変更後に GraphQL 型を再生成
```

Cart Transform Function のセットアップ:
```bash
cd bto-calculator
pnpm install
pnpm run build     # Rust → WASM にコンパイル
pnpm run deploy    # Shopify へデプロイ（事前に shopify app dev が必要）
```

---

## 新しい BTO モデルの追加方法

1. 上記スキーマに従い `bto-configs/<sku-lowercase>.json` を作成
2. `node scripts/import-bto.cjs` を実行 — コンポーネント商品を作成し、メタオブジェクトを拡充
3. [`app/routes/_index.jsx`](app/routes/_index.jsx) の `GTUNE_LINEUP` に `active: true` と正しい `btoHandle` でエントリを追加
4. `/bto/<metaobject-handle>` にアクセスしてコンフィギュレーターを確認
5. `bto-calculator/` をデプロイして Cart Transform Function を新モデルに適用
