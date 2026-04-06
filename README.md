# BTO on Shopify — Hydrogen

A BTO (Build To Order) PC configurator built on [Shopify Hydrogen](https://shopify.dev/docs/storefronts/headless/hydrogen) (v2026.1.3), modelled after the [Mouse Computer G TUNE configurator](https://www2.mouse-jp.co.jp/cart/spec.asp?PROD=FZI9G90G8BFDW104DEC).

**Live demo store:** `nobu-note-store.myshopify.com`

---

## How it works

### Architecture overview

```
bto-configs/fz-i9g90.json
  └── scripts/import-bto.cjs (Admin GraphQL API 2026-04)
        ├── Creates Metaobject: bto_product (config JSON with variant IDs)
        └── Creates component Shopify Products (one per selectable option)

Hydrogen storefront (Storefront API 2026-04)
  ├── / (homepage)      → fetches base product image + price → G TUNE brand page
  └── /bto/:handle      → fetches bto_product metaobject → BTO configurator UI
        └── Add to cart → CartForm (LinesAdd)
              ├── 1x base product line   (_bto_role=base,      _bto_bundle_id=<uuid>)
              └── Nx component lines     (_bto_role=component, _bto_bundle_id=<uuid>)

bto-calculator/ (Shopify App — Functions API 2026-04)
  └── Cart Transform Function (Rust/WASM)
        └── Groups lines by _bto_bundle_id → linesMerge → single bundle at checkout
```

**Price integrity:** component product prices are set in Shopify and immutable by the client. No price values are passed as cart attributes.

---

## Data model

### Metaobject: `bto_product`

Stores the full configuration for each BTO model, including all selectable options with `shopify_variant_id` written back by the import script.

| Field | Type | Description |
|---|---|---|
| `product_name` | single_line_text | Display name, e.g. `G TUNE FZ-I9G90` |
| `sku` | single_line_text | Product SKU / config code |
| `base_price` | number_integer | Base price (tax included, JPY) |
| `version` | single_line_text | Config version string |
| `hardware_config` | json | CPU, memory, storage, GPU, etc. |
| `peripheral_config` | json | Monitors, keyboards, mice, etc. |
| `service_config` | json | OS, office software, warranty, etc. |

Each JSON config follows this schema:

```jsonc
{
  "sections": [
    {
      "name": "CPU",
      "slug": "cpu",
      "type": "fixed",           // fixed | single_select | multi_select
      "sort_order": 1,
      "fixed_value": "Core Ultra 9 285K",
      "shopify_variant_id": "gid://shopify/ProductVariant/..."  // written by import script
    },
    {
      "name": "メモリ",
      "slug": "memory",
      "type": "single_select",
      "sort_order": 3,
      "options": [
        {
          "name": "64GB DDR5",
          "price_incl": 0,        // tax-included delta from base price
          "price_excl": 0,
          "is_default": true,
          "is_recommended": false,
          "shopify_variant_id": "gid://shopify/ProductVariant/..."  // written by import script
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

### Component Products

The import script creates one Shopify Product per BTO component (all section types). These products:
- Are tagged `bto-component`, `bto-base:<handle>`, `bto-section:<slug>`
- Have inventory tracking enabled (`inventoryManagement: SHOPIFY`)
- Are priced at the option's `price_incl` delta (¥0 for defaults and fixed components)
- Are excluded from storefront collections/listings

---

## Key files

### Routes

#### [`app/routes/_index.jsx`](app/routes/_index.jsx) — G TUNE brand homepage

**Storefront API queries:**
- `productByIdentifier` alias per active product → fetches image + base price

**What it renders:**
- G TUNE hero banner (red/black brand styling)
- Category filter tabs: すべて / デスクトップPC / ノートPC (client-side)
- Product grid — FZ-I9G90 links to `/bto/fzi9g90g8bfdw104dec`; other models show 近日公開

---

#### [`app/routes/bto.$handle.jsx`](app/routes/bto.$handle.jsx) — BTO configurator

**URL pattern:** `/bto/:handle` (e.g. `/bto/fzi9g90g8bfdw104dec`)

**Storefront API queries (loader):**
1. `metaobject(handle: {type: 'bto_product', handle})` — full config JSON (including variant IDs)
2. `product(handle: 'g-tune-fz-i9g90')` — base product variant ID for the cart base line

**What it renders:**
- Three-tab layout: ハードウェア / 周辺機器 / ソフト・サービス
- `BTOCategory` accordion per section:
  - `fixed` → static spec label
  - `single_select` → radio group
  - `multi_select` → checkbox group
- Sticky sidebar: live price (base + option deltas), add-to-cart button

**Add to cart — multi-line bundle:**
```jsx
// All lines share a crypto.randomUUID() bundle ID
<CartForm route="/cart" action={CartForm.ACTIONS.LinesAdd} inputs={{lines: buildCartLines()}}>
```

Lines added per BTO order:
| Line | `merchandiseId` | Key attributes |
|---|---|---|
| Base product | `variantId` (base PC) | `_bto_bundle_id`, `_bto_role=base`, `_bto_product` |
| Fixed component × N | `section.shopify_variant_id` | `_bto_bundle_id`, `_bto_role=component`, `_bto_section` |
| Selected option × N | `option.shopify_variant_id` | `_bto_bundle_id`, `_bto_role=component`, `_bto_section` |

> **Note:** No price values are passed as attributes. Prices come from the Shopify product variant records and are enforced by the Cart Transform Function — they cannot be tampered with client-side.

---

### Cart display

#### [`app/components/CartLineItem.jsx`](app/components/CartLineItem.jsx)
- Hides `"Default Title"` variant label
- Shows public line attributes (non-`_` prefix) as a `dt/dd` list

#### [`app/components/CartMain.jsx`](app/components/CartMain.jsx)
- Shows cart-level public attributes above the order summary

---

### Cart Transform Function — `bto-calculator/`

Located in a separate Shopify app repository at `bto-calculator/`.

**Extension:** `extensions/cart-transformer-bto/` (Rust → WebAssembly)

**Target:** `cart.transform.run` (Functions API `2026-04`)

**Input query** fetches per cart line:
- `id`, `quantity`
- `attribute(key: "_bto_bundle_id")` — groups lines into bundles
- `attribute(key: "_bto_role")` — identifies base vs component lines
- `attribute(key: "_bto_product")` — bundle display name
- `merchandise { ... on ProductVariant { id } }` — base variant for `parentVariantId`

**Logic:**
1. Groups all lines by `_bto_bundle_id`
2. For each group: finds the base line, merges all lines via `linesMerge`
3. Result at checkout: one "G TUNE FZ-I9G90 カスタム構成" bundle line
4. Non-BTO lines pass through unchanged

---

## Shopify App setup (Admin API access)

The import script authenticates via a **Shopify custom app** (OAuth). Create one in the Shopify Partner Dashboard or directly in the store admin.

### Required API scopes

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

> `read_publications` / `write_publications` are required for `publishablePublish` — without them, component products are created but not published to any sales channel, causing the Storefront API to silently ignore them when adding to cart.

### Setup steps

1. Go to **Shopify Admin → Settings → Apps and sales channels → Develop apps**
2. Create a new app (e.g. `bto-importer`)
3. Under **Configuration → Admin API access scopes**, add all scopes listed above
4. Install the app on the store
5. Copy the **Client ID** and **Client Secret** to `.env`:

```bash
SHOPIFY_CLIENT_ID=your_client_id
SHOPIFY_CLIENT_SECRET=your_client_secret
SHOPIFY_STORE_DOMAIN=nobu-note-store.myshopify.com
SHOPIFY_SCOPES=read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_products,write_products,read_publications,write_publications
```

### Publication IDs (nobu-note-store.myshopify.com)

The import script publishes component products to these two sales channels (hardcoded in `scripts/import-bto.cjs`):

| Publication | ID |
|---|---|
| Online Store | `gid://shopify/Publication/247009149240` |
| Hydrogen storefront | `gid://shopify/Publication/294215582008` |

> To find publication IDs for a different store, run: `{ publications(first: 10) { nodes { id name } } }` in the Admin GraphQL API.

---

## API reference

### Shopify APIs used — versions

| API | Version | Where used |
|---|---|---|
| Admin GraphQL API | `2026-04` | `scripts/import-bto.cjs` |
| Storefront API | Hydrogen default (`2026-04`) | `app/routes/*.jsx` |
| Functions API | `2026-04` | `bto-calculator/` Cart Transform |

### Admin GraphQL mutations & queries (`scripts/import-bto.cjs`)

| Operation | Type | Purpose |
|---|---|---|
| `metaobjectDefinitionCreate` | mutation | Create `bto_product` metaobject definition (once) |
| `metaobjectUpsert` | mutation | Create/update BTO config metaobject entry |
| `productByIdentifier(identifier: {handle})` | query | Check if component product already exists |
| `productCreate(product: ProductCreateInput)` | mutation | Create component product shell |
| `productVariantsBulkUpdate` | mutation | Set price + inventory tracking on default variant |

### Storefront API queries (`app/routes/`)

| Query | File | Purpose |
|---|---|---|
| `product(handle:)` via aliased `productByIdentifier` | `_index.jsx` | Fetch base product image + price for brand page |
| `metaobject(handle: {type, handle})` | `bto.$handle.jsx` | Fetch BTO config JSON |
| `product(handle:)` | `bto.$handle.jsx` | Fetch base product variant ID for cart |

### Functions API — Cart Transform input query

| Field | Path | Purpose |
|---|---|---|
| `attribute(key: "_bto_bundle_id")` | `cart.lines[]` | Groups lines into one BTO bundle |
| `attribute(key: "_bto_role")` | `cart.lines[]` | Identifies base vs component line |
| `attribute(key: "_bto_product")` | `cart.lines[]` | Bundle title (product name) |
| `merchandise { ... on ProductVariant { id } }` | `cart.lines[]` | `parentVariantId` for `linesMerge` |

---

## Import script

BTO config JSON files live in [`bto-configs/`](bto-configs/). The import script creates all Shopify products and metaobjects needed for the configurator.

```bash
# 1. Set credentials in .env
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_STORE_DOMAIN=nobu-note-store.myshopify.com
SHOPIFY_SCOPES=read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_products,write_products

# 2. Run (opens browser for OAuth)
node scripts/import-bto.cjs
```

What it does:
1. OAuth via browser → Shopify access token
2. Creates `bto_product` metaobject definition (skips if exists)
3. For each config file: creates one Shopify Product per component (all section types)
4. Writes `shopify_variant_id` back into the config JSON per option/section
5. Upserts the metaobject with the enriched JSON
6. Saves the updated JSON to disk (so re-runs skip already-created products)

---

## Getting started

**Requirements:** Node.js 18+, Rust + `wasm32-unknown-unknown` target

```bash
npm install
npm run dev        # starts Hydrogen dev server
npm run build      # production build
npm run codegen    # regenerate GraphQL types after query changes
```

To set up the Cart Transform Function:
```bash
cd bto-calculator
pnpm install
pnpm run build     # compiles Rust → WASM
pnpm run deploy    # deploys to Shopify (requires shopify app dev first)
```

---

## Adding a new BTO model

1. Create `bto-configs/<sku-lowercase>.json` following the schema above
2. Run `node scripts/import-bto.cjs` — creates component products + enriches metaobject
3. Add an entry to `GTUNE_LINEUP` in [`app/routes/_index.jsx`](app/routes/_index.jsx) with `active: true` and the correct `btoHandle`
4. Visit `/bto/<metaobject-handle>` to verify the configurator
5. Deploy `bto-calculator/` to apply the Cart Transform Function to the new model
