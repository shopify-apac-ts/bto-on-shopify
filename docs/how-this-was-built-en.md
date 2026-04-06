# How This Was Built: BTO PC Configurator on Shopify Hydrogen

## 1. Overview

This project implements a **Build To Order (BTO) PC configurator** on Shopify Hydrogen, modelled after the [Mouse Computer G TUNE configurator](https://www2.mouse-jp.co.jp/cart/spec.asp?PROD=FZI9G90G8BFDW104DEC). It demonstrates how to build a complex, inventory-tracked, tamper-proof product configurator entirely on Shopify's platform — without any external pricing service or custom backend.

**Live demo store:** `nobu-note-store.myshopify.com`

### Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Storefront framework | Shopify Hydrogen | 2026.1.3 |
| Router | React Router | 7.12 |
| Cart transform logic | Shopify Functions (Rust/WASM) | Functions API 2026-04 |
| Data ingestion | Node.js import script | Admin API 2026-04 |
| Storefront queries | GraphQL | Storefront API 2026-04 |
| Runtime target | WebAssembly (`wasm32-unknown-unknown`) | — |

The core design principle is **price authority through Shopify's product catalog**: every selectable option is a real Shopify product variant with a price set in the admin. No price values travel through the browser as attributes or query parameters, making the system tamper-proof by construction.

---

## 2. High-Level System Architecture

The system spans two git repositories and three runtime environments:

```
┌─────────────────────────────────────────────────────────────────────┐
│  REPOSITORY 1: bto-on-shopify (Hydrogen storefront)                 │
│                                                                     │
│  bto-configs/                                                       │
│  └── fz-i9g90.json  ──────────────────────────────────────────────┐ │
│                                                                   │ │
│  scripts/import-bto.cjs                                           │ │
│  └── OAuth → Admin API 2026-04 ────────────────────────────────┐  │ │
│                                                                 │  │ │
│  app/routes/                                                    │  │ │
│  ├── _index.jsx         (G TUNE brand homepage)                 │  │ │
│  └── bto.$handle.jsx    (BTO configurator UI)                   │  │ │
│                                                                 │  │ │
└─────────────────────────────────────────────────────────────────│──┘ │
                                                                  │    │
┌─────────────────────────────────────────────────────────────────│────┘
│  SHOPIFY PLATFORM                                                │
│                                                                  │
│  Admin API ◄──────────────────────────────────────────────────── ┘
│  ├── Metaobject: bto_product  (config JSON + variant IDs)
│  └── Products: component products (one per selectable option)
│                                                                  │
│  Storefront API ◄──────── Hydrogen loader queries ───────────────┘
│                                                                  │
│  Cart ────────────────────────────────────────────────────────────┐
│  (52 lines pre-Function: 1 base + N component lines)             │
│                                                                  │
│  Cart Transform Function ─────────────────────────────────────── ┘
│  └── linesMerge → 1 bundle line at checkout                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  REPOSITORY 2: bto-calculator (Shopify App)                         │
│                                                                     │
│  extensions/cart-transformer-bto/                                   │
│  ├── src/cart_transform_run.rs      (Rust logic)                    │
│  └── src/cart_transform_run.graphql (Function input query)          │
│                                                                     │
│  Deployed via: shopify app deploy                                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow at a glance:**

```
[JSON config file]
      │
      ▼ node scripts/import-bto.cjs (Admin API)
[Shopify Admin]
  ├── Metaobject (bto_product) — holds enriched config JSON
  └── Component Products (one per option) — hold prices + inventory
      │
      ▼ Storefront API (Hydrogen loader)
[Hydrogen React UI]
  └── User selects options → CartForm.LinesAdd (1 base + N components)
      │
      ▼ Cart
[Shopify Cart]  (52 raw lines with _bto_bundle_id attribute)
      │
      ▼ Cart Transform Function (Rust/WASM)
[Checkout]  (1 merged bundle: "G TUNE FZ-I9G90 カスタム構成")
```

---

## 3. Data Model

### Metaobject: `bto_product`

Each BTO model has one metaobject entry. The metaobject type is created once by the import script and set to `PUBLIC_READ` so the Storefront API can access it without authentication.

| Field | Type | Description |
|---|---|---|
| `product_name` | `single_line_text_field` | Display name, e.g. `G TUNE FZ-I9G90` |
| `sku` | `single_line_text_field` | Product SKU / config code, e.g. `FZI9G90G8BFDW104DEC` |
| `base_price` | `number_integer` | Base price (tax-included, JPY), e.g. `1089800` |
| `version` | `single_line_text_field` | Config version string, e.g. `2026-04-02-v1` |
| `hardware_config` | `json` | CPU, memory, storage, GPU, cooling, etc. |
| `peripheral_config` | `json` | Monitors, keyboards, mice, headsets, etc. |
| `service_config` | `json` | OS, office software, warranty, support plans |

The metaobject handle is derived from the SKU: `FZI9G90G8BFDW104DEC` → `fzi9g90g8bfdw104dec`, which becomes the URL path `/bto/fzi9g90g8bfdw104dec`.

### Config JSON Schema

Each of the three config fields (`hardware_config`, `peripheral_config`, `service_config`) uses the same schema. Three section types are supported:

```jsonc
{
  "sections": [
    // Type 1: fixed — always-included component, no user choice
    {
      "name": "CPU",
      "slug": "cpu",
      "type": "fixed",
      "sort_order": 2,
      "fixed_value": "インテル(R) Core(TM) Ultra 9 プロセッサー 285K",
      "shopify_variant_id": "gid://shopify/ProductVariant/52030945755448"
    },

    // Type 2: single_select — radio group, exactly one option chosen
    {
      "name": "メモリ",
      "slug": "memory",
      "type": "single_select",
      "sort_order": 5,
      "options": [
        {
          "name": "64GB DDR5-5600",
          "price_incl": 0,        // tax-included delta from base price
          "price_excl": 0,
          "is_default": true,
          "is_recommended": false,
          "shopify_variant_id": "gid://shopify/ProductVariant/..."
        },
        {
          "name": "128GB DDR5-5600",
          "price_incl": 343200,   // +¥343,200 upgrade delta
          "price_excl": 312000,
          "is_default": false,
          "is_recommended": true,
          "shopify_variant_id": "gid://shopify/ProductVariant/..."
        }
      ]
    },

    // Type 3: multi_select — checkbox group, zero or more options
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

### Component Products

The import script creates one Shopify Product per BTO component. These products are not meant to be browsed or purchased independently — they exist purely to give Shopify authority over prices and inventory.

| Attribute | Value |
|---|---|
| Handle pattern | `bto-{sku-lowercase}-{section_slug}` (fixed) or `bto-{sku-lowercase}-{section_slug}-{option_index}` (select) |
| Title | `[BTO部品] {section name}: {option name}` |
| Price | `option.price_incl` (¥0 for fixed components and default options) |
| Status | `ACTIVE` |
| Tags | `bto-component`, `bto-base:g-tune-fz-i9g90`, `bto-section:{slug}`, `bto-fixed` or `bto-upgrade` |
| Inventory | Tracked (`inventoryManagement: SHOPIFY`, `inventoryPolicy: DENY`) |
| Published to | Online Store + Hydrogen storefront (required for Storefront API visibility) |

### Relationship Diagram

```
bto-configs/fz-i9g90.json
  │
  ├── hardware_config.sections[]
  │     ├── [fixed]         ──────────► Shopify Product (¥0, inventory tracked)
  │     │                                  ▲ shopify_variant_id written back
  │     ├── [single_select]
  │     │     └── options[]  ──────────► Shopify Product per option (price = delta)
  │     │                                  ▲ shopify_variant_id written back
  │     └── [multi_select]
  │           └── options[]  ──────────► Shopify Product per option
  │
  ├── peripheral_config.sections[] ──► same pattern
  └── service_config.sections[]   ──► same pattern
         │
         ▼ upserted to
  Shopify Metaobject (bto_product)
    └── config JSON now contains all shopify_variant_id values
         │
         ▼ queried by
  Hydrogen storefront (Storefront API)
    └── metaobject fields → parse JSON → render UI → CartForm
```

---

## 4. Import Script (`scripts/import-bto.cjs`)

### Purpose

The import script is a one-shot Node.js script that seeds Shopify with all the data the configurator needs. It runs locally by the developer, opens a browser for OAuth consent, and then communicates directly with the Admin API.

### Authentication: OAuth Flow

```
Developer terminal                 Browser                    Shopify
     │                               │                            │
     │  node scripts/import-bto.cjs  │                            │
     │──────────────────────────────►│                            │
     │                               │                            │
     │  HTTP server on :3100         │                            │
     │  Auto-opens browser           │                            │
     │                               │  GET /oauth/authorize      │
     │                               │───────────────────────────►│
     │                               │                            │
     │                               │  Merchant approves app     │
     │                               │◄───────────────────────────│
     │                               │                            │
     │  GET /auth/callback?code=...  │                            │
     │◄──────────────────────────────│                            │
     │                               │                            │
     │  POST /admin/oauth/access_token                            │
     │───────────────────────────────────────────────────────────►│
     │                               │                            │
     │  { access_token: "..." }      │                            │
     │◄───────────────────────────────────────────────────────────│
     │                               │                            │
     │  runImport(accessToken)       │                            │
     │  → Admin GraphQL API calls    │                            │
```

### Step-by-Step Execution

**Step 1: Create metaobject definition**

Calls `metaobjectDefinitionCreate` to register the `bto_product` type with all field definitions. If the type already exists, the script detects the `already exists` error and skips gracefully.

**Step 2: Create component products**

For each section across all three config groups (`hardware_config`, `peripheral_config`, `service_config`):

- `fixed` sections: one product created with `productCreate`, price `¥0`, tags include `bto-fixed`
- `single_select` / `multi_select` sections: one product per option, price set to `option.price_incl`

Product creation is idempotent: `getProductByHandle` is called first, and if the product exists, it publishes and updates the title but does not re-create it.

Variant price and inventory are set via a separate `productVariantsBulkUpdate` call (required because `ProductCreateInput` in API version 2026-04 does not accept variant fields inline).

**Step 3: Publish to sales channels**

`publishablePublish` is called for each component product, publishing to:
- `gid://shopify/Publication/247009149240` — Online Store
- `gid://shopify/Publication/294215582008` — Hydrogen storefront

This step is critical: without publication, the Storefront API silently drops the variant from `cart.lines` when adding to cart.

**Step 4: Write `shopify_variant_id` back into JSON**

After each product is created or found, its variant ID is patched directly into the in-memory config object:

```js
// fixed section
section.shopify_variant_id = variantId;

// select option
option.shopify_variant_id = variantId;
```

**Step 5: Upsert metaobject**

`metaobjectUpsert` is called with the enriched config JSON (now containing all variant IDs). The metaobject handle is derived from the SKU: `FZI9G90G8BFDW104DEC` → `fzi9g90g8bfdw104dec`.

**Step 6: Save updated JSON to disk**

The enriched JSON is written back to `bto-configs/fz-i9g90.json`. On subsequent runs, the script finds products by handle and skips creation, only publishing and updating titles.

### Required API Scopes

| Scope | Purpose |
|---|---|
| `read_metaobject_definitions` | Check if definition already exists |
| `write_metaobject_definitions` | Create the `bto_product` definition |
| `read_metaobjects` | Not strictly required, but good practice |
| `write_metaobjects` | `metaobjectUpsert` calls |
| `read_products` | `productByIdentifier` lookups (idempotency check) |
| `write_products` | `productCreate`, `productVariantsBulkUpdate`, `productUpdate` |
| `read_publications` | Not strictly required by script, but listed in README |
| `write_publications` | `publishablePublish` calls — critical for Storefront API visibility |

### Admin API Operations Summary

| Operation | Type | Purpose |
|---|---|---|
| `metaobjectDefinitionCreate` | mutation | Register `bto_product` type (once per store) |
| `metaobjectUpsert` | mutation | Create or update a BTO config entry |
| `productByIdentifier(identifier: {handle})` | query | Idempotency check before product creation |
| `productCreate` | mutation | Create a component product shell |
| `productVariantsBulkUpdate` | mutation | Set price + inventory on the auto-created default variant |
| `productUpdate` | mutation | Update title on re-runs |
| `publishablePublish` | mutation | Publish to Online Store + Hydrogen sales channels |

### Publication IDs for `nobu-note-store.myshopify.com`

| Channel | Publication ID |
|---|---|
| Online Store | `gid://shopify/Publication/247009149240` |
| Hydrogen storefront | `gid://shopify/Publication/294215582008` |

To find publication IDs for a different store, run this in the Admin GraphQL API explorer:

```graphql
{ publications(first: 10) { nodes { id name } } }
```

---

## 5. Hydrogen Storefront

### Homepage (`app/routes/_index.jsx`)

The homepage renders a G TUNE brand page inspired by Mouse Computer's gaming PC line. It combines static product lineup data with live Shopify pricing.

**Storefront query:** One aliased `product(handle:)` query per active product fetches `priceRange.minVariantPrice` and `featuredImage`. Only the FZ-I9G90 is currently `active: true` in `GTUNE_LINEUP`.

**What it renders:**
- Hero banner with G TUNE logo and tagline (red/black gaming brand styling)
- Category filter tabs: すべて / デスクトップPC / ノートPC (client-side state, no server round-trip)
- Product grid — active models link to `/bto/{btoHandle}`; inactive models show "近日公開"

### BTO Configurator Page (`app/routes/bto.$handle.jsx`)

**URL pattern:** `/bto/:handle` — e.g. `/bto/fzi9g90g8bfdw104dec`

#### Loader Data Flow

```
params.handle = "fzi9g90g8bfdw104dec"
     │
     ├──► BTO_QUERY: metaobject(handle: {type: "bto_product", handle})
     │      └── returns: handle, type, fields[]{key, value}
     │            └── parse fields into: productName, sku, basePrice,
     │                hardware_config, peripheral_config, service_config
     │
     ├──► PRODUCT_VARIANT_QUERY: product(handle: "g-tune-fz-i9g90")
     │      └── returns: id, featuredImage, variants.nodes[0].id
     │
     └──► VARIANTS_AVAILABILITY_QUERY: nodes(ids: [...all variant IDs...])
            └── returns: { id, availableForSale } per variant
            └── stored as: availabilityMap { variantId: boolean }
```

All three queries run in sequence in the loader. The variant IDs for the availability query are collected by walking all sections and gathering `shopify_variant_id` values.

#### Component State

```
initialSelections = {
  [section.slug]: defaultOptionIndex   // for single_select
  [section.slug]: []                   // for multi_select
}
```

`selections` is managed via `useState`. Price is recalculated on every render using `useMemo`:

```js
totalPrice = basePrice
           + Σ single_select option[selected].price_incl
           + Σ multi_select option[selected].price_incl
```

#### Inventory Check

Before the CartForm submits, `checkInventory()` walks the current selections and returns a list of out-of-stock items (where `availabilityMap[variantId] === false`). If any are found, the default form action is prevented and an out-of-stock dialog is shown instead.

Only non-default `single_select` upgrades and all `multi_select` selections are checked — fixed components and default options are excluded since those are part of the standard configuration and always expected to be available.

#### Building Cart Lines

`buildCartLines()` runs at submit time (not on render), generating a fresh `crypto.randomUUID()` bundle ID each time:

```
Cart lines added for one BTO configuration:

┌─────────────────────────────────────────────────────────────────────┐
│  Line 1: Base product                                               │
│    merchandiseId: variantId (g-tune-fz-i9g90 default variant)      │
│    quantity: 1                                                      │
│    attributes:                                                      │
│      _bto_bundle_id = "550e8400-e29b-41d4-a716-446655440000"        │
│      _bto_role      = "base"                                        │
│      _bto_product   = "G TUNE FZ-I9G90"                            │
│      _bto_upgrades  = "メモリ: 128GB DDR5 / GPU: RTX 5090 OC"      │
├─────────────────────────────────────────────────────────────────────┤
│  Line 2: CPU (fixed component)                                      │
│    merchandiseId: section.shopify_variant_id                        │
│    attributes: _bto_bundle_id (same), _bto_role="component"        │
├─────────────────────────────────────────────────────────────────────┤
│  Line 3: Selected OS option                                         │
│    merchandiseId: option.shopify_variant_id                         │
│    attributes: _bto_bundle_id (same), _bto_role="component"        │
├─────────────────────────────────────────────────────────────────────┤
│  ...                                                                │
│  Line N: Last component                                             │
└─────────────────────────────────────────────────────────────────────┘
  Total: 1 base + (number of fixed sections) + (selected options)
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

### Cart Display (`app/components/CartMain.jsx`)

CartMain detects two states of the cart lines:

```
CartMain line classification:

allLines from cart.lines.nodes
     │
     ├── has parentRelationship.parent → skip (child of bundle, handled by parent)
     │
     ├── no _bto_bundle_id AND has _bto_product OR _bto_upgrades
     │     → mergedBtoLines[] (post-Function: Cart Transform already ran)
     │     → rendered by <MergedBTOLineItem>
     │
     ├── has _bto_bundle_id
     │     → bundleMap[bundleId] (pre-Function: raw lines)
     │     → rendered by <BTOBundleItem> (base + collapsible component list)
     │
     └── no BTO attributes
           → nonBtoLines[]
           → rendered by <CartLineItem> (standard)
```

**`MergedBTOLineItem`** (post-Function): Displays product name + "カスタム構成", total price, and `_bto_upgrades` summary string. The merged line retains `_bto_upgrades` because the Rust function explicitly forwards it via the `attributes` field of `LinesMergeOperation`.

**`BTOBundleItem`** (pre-Function): Displays the base product with a toggle button to show/hide the N component lines. The "Remove" button passes all line IDs (base + all components) to `CartForm.ACTIONS.LinesRemove`.

---

## 6. Cart Bundle Architecture

### Why Real Products Instead of Attributes

A naive BTO implementation might add one cart line with the total price as a custom attribute. This approach has a critical security flaw: the Storefront API allows clients to set arbitrary attribute values, including `_total_price`. A user could set `_total_price=1` and pay ¥1 for a ¥1,000,000 PC.

This implementation avoids that entirely:

```
WRONG approach (tamper-prone):
  Cart line: { price_attr: "1089800", total_price_attr: "1089800" }
  → Client can set price_attr to anything

CORRECT approach (this implementation):
  Cart lines: base product (¥1,089,800) + component products (¥0 or delta)
  → Prices come from Shopify product variant records
  → Storefront API enforces the prices; no client attribute changes them
```

### Bundle ID Pattern

Every BTO configuration gets a UUID generated at submit time:

```js
const bundleId = crypto.randomUUID();
// e.g. "550e8400-e29b-41d4-a716-446655440000"
```

This UUID is attached to every line in the batch as `_bto_bundle_id`. The Cart Transform Function groups lines by this UUID to form the bundle.

### Line Attribute Schema

| Attribute Key | Example Value | Present On | Visible to Customer |
|---|---|---|---|
| `_bto_bundle_id` | `550e8400-e29b-...` | All BTO lines | No (underscore prefix) |
| `_bto_role` | `base` or `component` | All BTO lines | No |
| `_bto_product` | `G TUNE FZ-I9G90` | Base line only | No |
| `_bto_upgrades` | `メモリ: 128GB / GPU: OC` | Base line only | No (forwarded to merged line) |
| `_bto_section` | `メモリ` | Component lines | No |

All keys start with `_` — Shopify's Storefront API treats these as private and does not display them to customers in order confirmations.

### What Gets Added to Cart

```
Example: G TUNE FZ-I9G90 with memory upgrade and OS upgrade
(hardware_config has ~15 sections; peripheral_config ~10; service_config ~10)

Base line (×1):
  └── g-tune-fz-i9g90 default variant (¥1,089,800)

Fixed component lines (×N_fixed):
  ├── bto-fzi9g90g8bfdw104dec-cpu            (¥0)
  ├── bto-fzi9g90g8bfdw104dec-cpu_fan        (¥0)
  ├── bto-fzi9g90g8bfdw104dec-motherboard    (¥0)
  └── ... (all fixed sections)

Single-select component lines (×N_single_select):
  ├── bto-fzi9g90g8bfdw104dec-os-1           (¥8,800  ← Windows Pro upgrade)
  ├── bto-fzi9g90g8bfdw104dec-memory-1       (¥343,200 ← 128GB upgrade)
  └── ... (selected option per section)

Multi-select component lines (×N_multi_select_selected):
  └── ... (only if user checked any boxes)

Total: typically 40-52 cart lines for one BTO configuration
```

---

## 7. Cart Transform Function (`bto-calculator/`)

### Shopify App Setup

The Cart Transform Function lives in a separate Shopify app (`bto-calculator/`). It must be deployed to the same store as the Hydrogen storefront. After deploying, a `cartTransformCreate` Admin API mutation activates it.

The function target is `cart.transform.run` at Functions API version `2026-04`.

### Input Query

The function input query fetches exactly the attributes needed — keeping the query minimal reduces WASM execution cost:

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

### Algorithm

```
FUNCTION: cart_transform_run(input)

  groups = HashMap<bundle_id, (base_idx: Option<usize>, component_indices: Vec<usize>)>

  FOR EACH line at index i:
    IF line has no _bto_bundle_id → SKIP (non-BTO line, pass through)
    
    bundle_id = line._bto_bundle_id
    
    IF line._bto_role == "base":
      groups[bundle_id].base_idx = Some(i)
    ELSE:
      groups[bundle_id].component_indices.push(i)

  operations = []

  FOR EACH (bundle_id, (base_idx_opt, component_indices)) in groups:
    IF base_idx_opt is None → SKIP (malformed bundle)
    IF component_indices is empty → SKIP (nothing to merge)
    
    base_line = lines[base_idx]
    parent_variant_id = base_line.merchandise.id
    product_name = base_line._bto_product OR "G TUNE"
    title = "{product_name} カスタム構成"
    
    IF base_line has _bto_upgrades:
      attributes = [{ key: "_bto_upgrades", value: upgrades_value }]
    
    cart_lines = [base_line_id] + [component_line_id for each component]
    
    operations.push(LinesMerge {
      cart_lines,
      parent_variant_id,   ← base product variant (for image + title fallback)
      title,
      price: None,         ← NOT overriding price; sum of component prices used
      attributes,          ← forwarded _bto_upgrades for cart display
    })

  RETURN { operations }
```

### What `linesMerge` Does

```
BEFORE Cart Transform Function:

  Cart lines (52 total):
  ┌──────────────────────────────────────────────────────┐
  │ Line 1:  g-tune-fz-i9g90 (¥1,089,800) [base]        │
  │ Line 2:  bto-...-os-0    (¥0)         [component]   │
  │ Line 3:  bto-...-cpu     (¥0)         [component]   │
  │ Line 4:  bto-...-cpu_fan (¥0)         [component]   │
  │ ...                                                  │
  │ Line 52: bto-...-warranty-1 (¥5,500)  [component]   │
  └──────────────────────────────────────────────────────┘

AFTER Cart Transform Function (at checkout):

  Cart lines (1 total):
  ┌──────────────────────────────────────────────────────┐
  │ Bundle: "G TUNE FZ-I9G90 カスタム構成"               │
  │   parentVariantId: g-tune-fz-i9g90 variant           │
  │   price: sum of all 52 component prices              │
  │   attributes: { _bto_upgrades: "メモリ: 128GB / ..." }│
  └──────────────────────────────────────────────────────┘
```

The `price: None` field in `LinesMergeOperation` is intentional — by not specifying a price, Shopify computes the bundle price as the sum of all included line prices. This preserves tamper-proof pricing.

### Deployment

```bash
cd bto-calculator
pnpm install
pnpm run build     # compiles Rust → wasm32-unknown-unknown
shopify app deploy # uploads WASM to Shopify, activates function
```

After deployment, the function applies to all carts in the store automatically.

---

## 8. Security Design

### Price Authority

The fundamental security property of this system is that **price authority belongs entirely to Shopify's product catalog**:

```
Client browser                    Shopify
     │                               │
     │  CartForm.LinesAdd             │
     │  (no price in attributes)     │
     │─────────────────────────────► │
     │                               │
     │                          Shopify validates:
     │                          - Each merchandiseId exists
     │                          - Price from product variant record
     │                          - No attribute can override price
     │                               │
     │  Cart response (prices set)   │
     │◄──────────────────────────────│
```

Even if a user intercepted the CartForm submission and added a `_bto_total_price=1` attribute, Shopify would ignore it — cart line prices are always taken from the product variant's price field.

### Publication Requirement

Component products must be published to the Hydrogen storefront sales channel. If a product is unpublished:

- The Storefront API silently accepts the `LinesAdd` mutation
- The unpublished variant ID is silently dropped from the resulting cart
- The cart appears to have fewer items than expected, with no error

This is why `publishablePublish` is a required step in the import script and why `read_publications` / `write_publications` scopes are needed.

### Inventory Check

The loader fetches `availableForSale` for all component variants in a single `nodes(ids: [...])` query. This is checked client-side before allowing cart submission. However, the authoritative inventory check happens server-side when Shopify processes the `LinesAdd` — the client-side check is UX only (to show the out-of-stock dialog before the user reaches checkout and is surprised).

---

## 9. User Flow (End-to-End)

```
Customer                 Hydrogen (SSR)           Shopify APIs
    │                         │                         │
    │  GET /                  │                         │
    │────────────────────────►│                         │
    │                         │  Storefront: products   │
    │                         │────────────────────────►│
    │                         │◄────────────────────────│
    │  G TUNE brand page      │                         │
    │◄────────────────────────│                         │
    │                         │                         │
    │  Click FZ-I9G90         │                         │
    │────────────────────────►│                         │
    │                         │  Storefront:            │
    │                         │  metaobject + product   │
    │                         │  + variants availability│
    │                         │────────────────────────►│
    │                         │◄────────────────────────│
    │  BTO configurator page  │                         │
    │◄────────────────────────│                         │
    │                         │                         │
    │  Select options         │                         │
    │  (client-side state)    │                         │
    │  See live price         │                         │
    │                         │                         │
    │  Click "カートに追加"   │                         │
    │  (inventory check: OK)  │                         │
    │────────────────────────►│  CartForm.LinesAdd      │
    │                         │  (52 lines + bundle_id) │
    │                         │────────────────────────►│
    │                         │◄────────────────────────│
    │  Cart aside opens       │                         │
    │  (BTOBundleItem: base   │                         │
    │   + N component lines)  │                         │
    │◄────────────────────────│                         │
    │                         │                         │
    │  Click "Checkout"       │                         │
    │                         │  Cart Transform runs    │
    │                         │  (Rust/WASM Function)   │
    │                         │  52 lines → 1 bundle    │
    │                         │────────────────────────►│
    │                         │                         │
    │  Checkout page          │                         │
    │  "G TUNE FZ-I9G90       │                         │
    │   カスタム構成"          │                         │
    │  (single line, correct  │                         │
    │   total price)          │                         │
    │◄────────────────────────│                         │
    │                         │                         │
    │  Complete payment       │                         │
    │────────────────────────────────────────────────► │
    │                         │                         │
    │                         │         Order created   │
    │                         │         Inventory       │
    │                         │         decremented per │
    │                         │         component       │
```

---

## 10. API Reference

### Admin GraphQL Operations (import script)

| Operation | Type | API Version | Purpose |
|---|---|---|---|
| `metaobjectDefinitionCreate` | mutation | 2026-04 | Register `bto_product` type |
| `metaobjectUpsert` | mutation | 2026-04 | Create/update BTO config entry |
| `productByIdentifier(identifier: {handle})` | query | 2026-04 | Idempotency check |
| `productCreate` | mutation | 2026-04 | Create component product shell |
| `productVariantsBulkUpdate` | mutation | 2026-04 | Set price + inventory |
| `productUpdate` | mutation | 2026-04 | Update title on re-runs |
| `publishablePublish` | mutation | 2026-04 | Publish to sales channels |

### Storefront API Queries (Hydrogen routes)

| Query | File | Purpose |
|---|---|---|
| `product(handle:)` via alias | `_index.jsx` | Base product image + price for brand page |
| `metaobject(handle: {type, handle})` | `bto.$handle.jsx` | Full BTO config JSON |
| `product(handle: "g-tune-fz-i9g90")` | `bto.$handle.jsx` | Base product variant ID + featured image |
| `nodes(ids: [...])` with `ProductVariant` inline fragment | `bto.$handle.jsx` | Bulk availability check |

### Cart Transform Function Input Fields

| GraphQL Alias | Key | Used For |
|---|---|---|
| `bundleId` | `_bto_bundle_id` | Group lines into one bundle |
| `role` | `_bto_role` | Identify base vs component |
| `productName` | `_bto_product` | Bundle display title |
| `upgrades` | `_bto_upgrades` | Forward to merged bundle for cart display |
| `merchandise { ... on ProductVariant { id } }` | — | `parentVariantId` for `linesMerge` |

### Shopify Functions API

| Property | Value |
|---|---|
| API version | `2026-04` |
| Target | `cart.transform.run` |
| Runtime | WebAssembly (`wasm32-unknown-unknown`) |
| Language | Rust (via `shopify_function` crate) |
| Input size limit | ~64 KB (well within limits for typical BTO cart) |
| Activation | `cartTransformCreate` mutation after `shopify app deploy` |

---

## 11. Adding a New BTO Model

Follow these steps to add a new BTO model to the store.

**Step 1: Create the config JSON**

```bash
cp bto-configs/fz-i9g90.json bto-configs/new-model.json
# Edit new-model.json:
#   - Update product.name, product.sku, product.base_price_incl_tax
#   - Update product.version
#   - Replace all sections with the new model's configuration
#   - Remove all shopify_variant_id fields (the import script will fill these in)
```

The JSON structure must follow the schema in section 3. All `shopify_variant_id` fields should be absent or empty — the import script will write them back.

**Step 2: Update the import script to read the new file**

Currently `import-bto.cjs` hardcodes `fz-i9g90.json`. For a new model, either:
- Update the `jsonPath` variable in `runImport()`, or
- Make the filename a command-line argument

**Step 3: Run the import script**

```bash
# Ensure .env has all required credentials
node scripts/import-bto.cjs

# The script will:
# 1. Open your browser for OAuth
# 2. Create component products (~40-52 products for a typical desktop config)
# 3. Write shopify_variant_id back into the JSON
# 4. Upsert the bto_product metaobject
# 5. Save the enriched JSON to disk
```

**Step 4: Verify in Shopify Admin**

- Go to **Products** — you should see all new component products tagged `bto-component`
- Go to **Content → Metaobjects → BTO Product** — you should see the new entry

**Step 5: Add to the Hydrogen lineup**

In `app/routes/_index.jsx`, add an entry to `GTUNE_LINEUP`:

```js
{
  handle: 'new-model-shopify-handle',
  name: 'G TUNE NEW-MODEL',
  category: 'desktop',   // or 'note'
  tag: 'ミドルレンジ',
  description: '...',
  btoHandle: 'new-model-sku-lowercase',  // must match the metaobject handle
  active: true,
},
```

Also add the product to `GTUNE_PRODUCTS_QUERY` so pricing data loads:

```graphql
newmodel: product(handle: "new-model-shopify-handle") {
  id
  handle
  title
  priceRange { minVariantPrice { amount currencyCode } }
  featuredImage { id url altText width height }
}
```

**Step 6: Test the configurator**

```bash
npm run dev
# Visit: http://localhost:3000/bto/<new-model-sku-lowercase>
```

Verify:
- All sections render (fixed, single_select, multi_select)
- Price updates as you select options
- "カートに追加" adds lines to the cart

**Step 7: Deploy the Cart Transform Function**

The existing Cart Transform Function works for any `_bto_bundle_id` group — no function changes are needed. Simply ensure it is already deployed:

```bash
cd bto-calculator
pnpm run build
shopify app deploy
```

---

## 12. Known Limitations and Future Work

### Current Limitations

**`linesMerge` requires Shopify Plus or development store**

The `linesMerge` Cart Transform operation (which collapses 52 lines into 1 bundle at checkout) is only available on Shopify Plus plans and development stores. On a standard plan, the function will still run but `linesMerge` operations will be silently ignored, leaving 52 individual lines visible at checkout.

**One Cart Transform function per store**

Shopify allows only one active Cart Transform at a time. If the store already uses a Cart Transform for another purpose (e.g. a volume discount bundler), the BTO function cannot coexist without combining the logic into one function.

**Inventory tracking at ¥0 for default and fixed components**

Fixed sections and default options are priced at ¥0. Their inventory is tracked in Shopify, but since they are ¥0 products, they appear in admin product lists and could confuse store operators who are not aware of the BTO architecture.

**Cart shows 52 lines before the Cart Transform runs**

The Cart Transform Function runs at checkout, not when items are added to cart. In the Hydrogen cart aside, the user sees the raw 52 lines (grouped visually by `BTOBundleItem`, but still individually removable). After clicking "Checkout", the Function merges them.

**Import script hardcodes one config file**

`scripts/import-bto.cjs` currently hardcodes `bto-configs/fz-i9g90.json`. Adding multiple models requires editing the script or adding CLI argument support.

**BTO configurator page hardcodes the base product handle**

In `bto.$handle.jsx`, the loader hardcodes `handle: 'g-tune-fz-i9g90'` for the base product query. Each new BTO model needs its own base product handle, which should ideally be stored in the metaobject rather than hardcoded.

### Future Work

- Add the base product Shopify handle as a field in the `bto_product` metaobject to eliminate the hardcoded product handle in the loader
- Support multiple config files in the import script via CLI arguments
- Add a `cartTransformCreate` automation step to the import script so new deployments are fully self-contained
- Add a "compare configurations" feature (side-by-side diff of selected options)
- Implement server-side inventory reservation to prevent overselling between inventory check and checkout
- Add metafield-based configuration versioning so old orders continue to display the correct spec even after the metaobject is updated
