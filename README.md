# BTO on Shopify — Hydrogen

A BTO (Build To Order) PC configurator built on [Shopify Hydrogen](https://shopify.dev/docs/storefronts/headless/hydrogen) (v2026.1.3), modelled after the [Mouse Computer G TUNE configurator](https://www2.mouse-jp.co.jp/cart/spec.asp?PROD=FZI9G90G8BFDW104DEC).

**Live demo store:** `nobu-note-store.myshopify.com`

---

## How it works

### Architecture overview

```
Shopify Store (Admin)
  └── Metaobject: bto_product
        └── fields: product_name, sku, base_price,
                    hardware_config (JSON), peripheral_config (JSON), service_config (JSON)

Hydrogen (Storefront API)
  ├── / (homepage)          → fetches product image + price, renders G TUNE brand page
  └── /bto/:handle          → fetches metaobject, renders full BTO configurator
        └── Add to cart     → CartForm → /cart route → session-persisted cart
```

---

## Data model

BTO product configurations are stored as **Shopify Metaobjects** of type `bto_product`.

| Field | Type | Description |
|---|---|---|
| `product_name` | single_line_text | Display name, e.g. `G TUNE FZ-I9G90` |
| `sku` | single_line_text | Product SKU / config code |
| `base_price` | number_integer | Base price (tax included, JPY) |
| `version` | single_line_text | Config version string |
| `hardware_config` | json | CPU, memory, storage, GPU, etc. (see below) |
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
      "fixed_value": "Core Ultra 9 285K"
    },
    {
      "name": "メモリ",
      "slug": "memory",
      "type": "single_select",
      "sort_order": 3,
      "options": [
        {
          "name": "32GB DDR5",
          "price_incl": 0,        // tax-included delta from base price
          "price_excl": 0,        // tax-excluded delta
          "is_default": true,
          "is_recommended": false
        },
        {
          "name": "64GB DDR5",
          "price_incl": 22000,
          "price_excl": 20000,
          "is_default": false,
          "is_recommended": true
        }
      ]
    }
  ]
}
```

The matching **Shopify Product** (`g-tune-fz-i9g90`) holds the image and base price used by the storefront. BTO selections are attached to the cart line as **line item attributes**.

---

## Key files

### Routes

#### [`app/routes/_index.jsx`](app/routes/_index.jsx) — G TUNE brand homepage

**What it fetches:**
- `product(handle: "g-tune-fz-i9g90")` via Storefront API → image + base price

**What it renders:**
- G TUNE hero banner with red/black brand styling
- Category filter tabs (client-side, no re-fetch)
- Product grid — FZ-I9G90 is the only active card, linking to the BTO configurator. Other models show a 近日公開 placeholder.

```jsx
// Loader: fetch product image + price from Shopify
export async function loader({context}) {
  const data = await context.storefront.query(GTUNE_PRODUCTS_QUERY);
  // ...
}

// Component: static lineup + live data for active products
const GTUNE_LINEUP = [
  { handle: 'g-tune-fz-i9g90', active: true, btoHandle: 'fzi9g90g8bfdw104dec', ... },
  { handle: null, active: false, ... }, // coming soon
];
```

---

#### [`app/routes/bto.$handle.jsx`](app/routes/bto.$handle.jsx) — BTO configurator

**URL pattern:** `/bto/:handle` (e.g. `/bto/fzi9g90g8bfdw104dec`)

**What it fetches (loader):**

1. `metaobject(handle: {type: 'bto_product', handle})` — the full BTO config JSON
2. `product(handle: 'g-tune-fz-i9g90')` — the Shopify variant ID needed for cart

```jsx
export async function loader({params, context}) {
  const {metaobject} = await context.storefront.query(BTO_QUERY, {
    variables: { handle: {type: 'bto_product', handle: params.handle} },
  });
  // parse JSON fields: hardware_config, peripheral_config, service_config
  // fetch variantId for cart
}
```

**What it renders:**

- Three-tab layout: ハードウェア / 周辺機器 / ソフト・サービス
- `BTOCategory` accordion component for each config section:
  - `fixed` → static spec label (no selection)
  - `single_select` → radio group
  - `multi_select` → checkbox group
- Sticky sidebar with live price (base + all deltas)
- Add to cart via `CartForm` (see below)

**State:**
```jsx
// selections: { [slug]: number (index) | number[] }
const [selections, setSelections] = useState(initialSelections);

// totalPrice: derived from base + each selected option's price_incl delta
const totalPrice = useMemo(() => { ... }, [selections]);
```

---

### Cart integration

Cart add uses Hydrogen's `CartForm` component pointed at the existing `/cart` route. This is critical — it ensures `cart.setCartId()` is called to persist the cart session cookie.

```jsx
<CartForm
  route="/cart"
  action={CartForm.ACTIONS.LinesAdd}
  inputs={{
    lines: [{
      merchandiseId: variantId,
      quantity: 1,
      attributes: cartAttributes,  // BTO selections as line item attributes
    }],
  }}
>
  {(fetcher) => <button type="submit">カートに追加</button>}
</CartForm>
```

BTO selections are stored as **line item attributes**:

| Key | Value | Visible to customer |
|---|---|---|
| `_bto_product` | `G TUNE FZ-I9G90` | No (underscore prefix) |
| `_bto_total_price` | `1089800` | No |
| `os` | `Windows 11 Home 64ビット` | Yes |
| `memory` | `32GB DDR5` | Yes |
| `gpu` | `GeForce RTX 5090` | Yes |
| `gpu_price` | `330000` | Yes |

> **Convention:** attributes prefixed with `_` are internal (hidden from UI). Public attributes are shown as a `dt/dd` list in the cart.

---

### Components

#### [`app/components/CartLineItem.jsx`](app/components/CartLineItem.jsx)

- Hides `"Default Title"` variant label (Shopify's placeholder for single-variant products)
- Renders public line item attributes (non-`_` prefix) as a clean definition list

#### [`app/components/CartMain.jsx`](app/components/CartMain.jsx)

- Renders cart-level `attributes` above the order summary when present

---

## Importing BTO config data

BTO config JSON files live in [`bto-configs/`](bto-configs/). The import script uploads them to Shopify as Metaobjects via the Admin API.

```bash
# 1. Set credentials in .env
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_STORE_DOMAIN=nobu-note-store.myshopify.com

# 2. Run the import script (opens a browser for OAuth)
node scripts/import-bto.cjs
```

The script:
1. Authenticates via OAuth (browser redirect to Shopify)
2. Creates the `bto_product` Metaobject definition if it doesn't exist
3. Upserts Metaobject entries from all JSON files in `bto-configs/`

---

## Getting started

**Requirements:** Node.js 18+

```bash
npm install
npm run dev        # starts local dev server with Shopify CLI
npm run build      # production build
npm run codegen    # regenerate GraphQL types after query changes
```

---

## Adding a new BTO model

1. Create `bto-configs/<model-handle>.json` following the schema above
2. Run `node scripts/import-bto.cjs` to push it to Shopify
3. Create a matching Shopify Product with the same handle for image/price
4. Add an entry to `GTUNE_LINEUP` in `app/routes/_index.jsx` with `active: true`
5. Visit `/bto/<model-handle>` to verify
