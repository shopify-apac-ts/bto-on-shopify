# Plan: BTO Component Products + Cart Bundle via Cart Transform

## Context

Replace the current approach (single cart line + price attributes) with a proper multi-product bundle:
- Each selectable BTO option becomes a real Shopify Product (separate inventory, shared across base models)
- Adding to cart creates one line per selected non-default component + the base product
- Cart Transform Function merges them into a clean bundle for checkout presentation
- Pricing is **inherently tamper-proof**: prices come from Shopify product variant records, not client attributes

## Architecture

```
Import script:
  fz-i9g90.json → base product (existing) + component products (new, one per selectable option)
  Each option gets a shopify_variant_id stored back into the metaobject JSON

Storefront (bto.$handle.jsx):
  Loader: fetch metaobject (now includes variant IDs per option)
  Add to cart: 1x base product + 1x each selected non-default component
                all lines share _bto_bundle_id = crypto.randomUUID()

Cart Transform Function (Rust):
  Input query: cart lines with attributes + product handle
  Logic: group by _bto_bundle_id, call linesMerge with base as parentVariantId
  Result: checkout shows one clean "G TUNE FZ-I9G90 カスタム構成" bundle line

Price integrity:
  Component product prices = delta (price_incl) set in Shopify — immutable by client
  Base product price = base_price set in Shopify — immutable by client
  Total = sum of all lines, no client attribute can change it
```

## Component Product Schema

Created by import script for each non-fixed option with `price_incl >= 0`:

| Field | Value |
|---|---|
| Title | `{section_name} - {option_name}` |
| Handle | `bto-{base_sku-lowercase}-{section_slug}-{option_index}` e.g. `bto-fzi9g90-memory-1` |
| Price | `option.price_incl` (tax-included delta, ¥0 for zero-price non-defaults) |
| Status | `ACTIVE` but excluded from collections/storefront listings |
| Tags | `bto-component`, `bto-base:g-tune-fz-i9g90`, `bto-section:{slug}` |
| Inventory | Tracked (this is the point of separate products) |

**Default options** (`is_default: true, price_incl: 0`): also created as products (¥0) to support inventory tracking. Added to cart so every BTO build's component usage is tracked. Fixed sections (`type: "fixed"`) → NOT created (always-included, no selection).

After creating each product, the import script patches the metaobject to add `shopify_variant_id` to each option in the config JSON. This is how the storefront knows which variant to add to cart.

## Updated Config JSON (after import)

```json
{
  "name": "メモリ",
  "slug": "memory",
  "type": "single_select",
  "options": [
    {
      "name": "64GB DDR5…",
      "price_incl": 0,
      "is_default": true,
      "shopify_variant_id": "gid://shopify/ProductVariant/12345"
    },
    {
      "name": "128GB DDR5…",
      "price_incl": 343200,
      "is_default": false,
      "shopify_variant_id": "gid://shopify/ProductVariant/12346"
    }
  ]
}
```

## Implementation Steps

### Step 1 — Extend `scripts/import-bto.cjs`

Add to the existing OAuth + Admin API flow:

1. **Create component products** (new section after existing metaobject upsert):
   - For each config file, iterate all 3 config sections
   - For `single_select` and `multi_select` sections: create/update one product per option via `productCreate` / `productUpdate` mutation
   - Skip `fixed` sections
   - Store returned `variantId` per option

2. **Patch the metaobject** with updated config JSON containing `shopify_variant_id` per option:
   - Re-run `metaobjectUpdate` with the enriched JSON for `hardware_config`, `peripheral_config`, `service_config`

3. **Required extra Admin API scopes** (add to `SHOPIFY_SCOPES` in `.env`):
   ```
   write_products,read_products
   ```

### Step 2 — Update the Hydrogen loader

**File:** `app/routes/bto.$handle.jsx`

The loader already parses `hardware_config`, `peripheral_config`, `service_config` from the metaobject. After Step 1, those JSONs now contain `shopify_variant_id` per option — no extra queries needed.

No loader changes required.

### Step 3 — Update cart add in `bto.$handle.jsx`

Replace the current single-line `CartForm` with a multi-line add. Since `CartForm` with `LinesAdd` accepts an array of lines:

```jsx
// Build lines array at submit time
const buildCartLines = useCallback(() => {
  const bundleId = crypto.randomUUID();
  const baseAttrs = [
    {key: '_bto_bundle_id', value: bundleId},
    {key: '_bto_role', value: 'base'},
    {key: '_bto_product', value: productName},
  ];

  const lines = [{
    merchandiseId: variantId,   // base product
    quantity: 1,
    attributes: baseAttrs,
  }];

  for (const section of allSections) {
    if (section.type === 'fixed') continue;
    const selectedIndices = section.type === 'single_select'
      ? [selections[section.slug]]
      : (selections[section.slug] || []);

    for (const idx of selectedIndices) {
      const opt = section.options[idx];
      if (!opt?.shopify_variant_id) continue;
      lines.push({
        merchandiseId: opt.shopify_variant_id,
        quantity: 1,
        attributes: [
          {key: '_bto_bundle_id', value: bundleId},
          {key: '_bto_role', value: 'component'},
          {key: '_bto_section', value: section.name},
        ],
      });
    }
  }
  return lines;
}, [selections, allSections, variantId, productName]);
```

Remove `_bto_total_price` — no longer needed.

Keep the `CartForm` wrapper using `CartForm.ACTIONS.LinesAdd` with `inputs={{ lines: buildCartLines() }}`.

### Step 4 — Update Function input query

**File:** `bto-calculator/extensions/cart-transformer-bto/src/cart_transform_run.graphql`

```graphql
query CartTransformRunInput {
  cart {
    lines {
      id
      quantity
      attributes {
        key
        value
      }
      merchandise {
        __typename
        ... on ProductVariant {
          id
          product {
            handle
          }
        }
      }
    }
  }
}
```

### Step 5 — Implement Rust bundle logic

**File:** `bto-calculator/extensions/cart-transformer-bto/src/cart_transform_run.rs`

Logic:
1. Walk all lines, collect those with a `_bto_bundle_id` attribute
2. Group into a `HashMap<String, Vec<&CartLine>>` by bundle ID
3. For each group: find the base line (has `_bto_role = "base"`) → its `merchandise.id` becomes `parentVariantId`
4. Build a `linesMerge` operation with all lines in the group
5. Title: e.g., `"{product_name} カスタム構成"` (read from the base line's `_bto_product` attribute)
6. Non-BTO lines → no operation

```rust
use std::collections::HashMap;
use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[shopify_function]
fn cart_transform_run(
    input: schema::cart_transform_run::CartTransformRunInput,
) -> Result<schema::CartTransformRunResult> {
    // Group BTO lines by bundle ID
    let mut groups: HashMap<String, Vec<&schema::cart_transform_run::CartLine>> = HashMap::new();
    for line in &input.cart.lines {
        if let Some(bundle_id) = line.attributes.iter()
            .find(|a| a.key == "_bto_bundle_id")
            .map(|a| a.value.clone())
        {
            groups.entry(bundle_id).or_default().push(line);
        }
    }

    let mut operations = vec![];
    for (_, lines) in &groups {
        // Find the base line
        let base_line = lines.iter().find(|l|
            l.attributes.iter().any(|a| a.key == "_bto_role" && a.value == "base")
        );
        let Some(base) = base_line else { continue };

        let parent_variant_id = match &base.merchandise {
            schema::cart_transform_run::Merchandise::ProductVariant(v) => v.id.clone(),
            _ => continue,
        };

        let product_name = base.attributes.iter()
            .find(|a| a.key == "_bto_product")
            .map(|a| a.value.as_str())
            .unwrap_or("G TUNE カスタム構成");

        let cart_lines = lines.iter().map(|l| schema::CartLineInput {
            cart_line_id: l.id.clone(),
            quantity: l.quantity,
        }).collect();

        operations.push(schema::Operation::LinesMerge(schema::LinesMergeOperation {
            cart_lines,
            parent_variant_id,
            title: Some(format!("{} カスタム構成", product_name)),
            price: None,
            image: None,
            attributes: None,
        }));
    }

    Ok(schema::CartTransformRunResult { operations })
}
```

*(Exact Rust type names depend on `#[typegen]` output from schema — adjust to match)*

### Step 6 — Update cart display in Hydrogen

**File:** `app/components/CartMain.jsx` and/or `CartLineItem.jsx`

BTO component lines (those with `_bto_role = "component"`) should be visually nested under their base product in the Hydrogen cart aside/page (before the Transform Function merges them at checkout). Options:
- **Simple**: show them as normal lines — the merge happens at checkout anyway
- **Better**: group lines by `_bto_bundle_id` and show component lines indented under the base

For the initial implementation, simple is fine — the Function handles the checkout presentation.

## Files to Modify / Create

| File | Action |
|---|---|
| `scripts/import-bto.cjs` | Add component product creation + metaobject patch with variant IDs |
| `app/routes/bto.$handle.jsx` | Multi-line cart add with bundle ID; remove `_bto_total_price` |
| `bto-calculator/extensions/cart-transformer-bto/src/cart_transform_run.graphql` | Add attributes + merchandise.id to input query |
| `bto-calculator/extensions/cart-transformer-bto/src/cart_transform_run.rs` | Implement linesMerge logic |
| `bto-calculator/extensions/cart-transformer-bto/tests/fixtures/bto-bundle-merge.json` | Test fixture for bundle merge |

## Verification

1. Run `node scripts/import-bto.cjs` → confirm component products exist in Shopify Admin and metaobject fields contain `shopify_variant_id` per option
2. Visit `/bto/fzi9g90g8bfdw104dec`, select non-default options, add to cart → Hydrogen cart shows base product + component lines, each with `_bto_bundle_id`
3. Build function: `cd bto-calculator && shopify app build` → compiles without errors
4. Go to checkout on dev store → lines are merged into a single "G TUNE FZ-I9G90 カスタム構成" bundle
5. Tamper test: attempt to change a component product's price via Storefront API cart mutation → price remains unchanged (product variant price is authoritative)
6. Check Shopify Admin → inventory of selected component products decremented on order
