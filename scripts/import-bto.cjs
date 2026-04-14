#!/usr/bin/env node
/**
 * BTO on Shopify - Metaobject + Component Products インポートスクリプト
 *
 * Dev Dashboard アプリ (OAuth) 経由で Admin API にアクセスし、
 * 1. Metaobject定義の作成
 * 2. BTOデータのインポート (metaobject)
 * 3. 各オプション・固定コンポーネントを個別のShopify Productとして作成
 * 4. 各オプションに shopify_variant_id を書き戻してmetaobjectを更新
 *
 * 使い方:
 *   1. .env にクレデンシャルを設定
 *   2. node scripts/import-bto.cjs
 *   3. ブラウザでOAuth認可を許可
 *   4. 自動でインポート実行
 *
 * 必要な .env:
 *   SHOPIFY_CLIENT_ID=...
 *   SHOPIFY_CLIENT_SECRET=...
 *   SHOPIFY_STORE_DOMAIN=xxx.myshopify.com
 *   SHOPIFY_SCOPES=read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_products,write_products
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// ============================================================
// .env 読み込み（簡易版、dotenvなしで動作）
// ============================================================
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('.env ファイルが見つかりません:', envPath);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SCOPES = process.env.SHOPIFY_SCOPES || 'read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_products,write_products';
const PORT = 3100;
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;

if (!CLIENT_ID || !CLIENT_SECRET || !STORE_DOMAIN) {
  console.error('必須の環境変数が不足しています。.env を確認してください。');
  console.error('  SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN');
  process.exit(1);
}

// ============================================================
// HTTP ヘルパー
// ============================================================

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function adminGraphQL(token, query, variables = {}) {
  const url = `https://${STORE_DOMAIN}/admin/api/2026-04/graphql.json`;
  const body = JSON.stringify({ query, variables });
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
  }, body);

  if (res.data.errors) {
    console.error('GraphQL errors:', JSON.stringify(res.data.errors, null, 2));
  }
  return res.data;
}

// ============================================================
// Metaobject 定義作成
// ============================================================

async function createMetaobjectDefinition(token) {
  console.log('\n--- Metaobject定義 "bto_product" を作成中... ---');

  const query = `
    mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition {
          id
          type
          fieldDefinitions {
            key
            type { name }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    definition: {
      type: "bto_product",
      name: "BTO Product",
      access: {
        storefront: "PUBLIC_READ"
      },
      fieldDefinitions: [
        { key: "product_name",   name: "Product Name",      type: "single_line_text_field" },
        { key: "sku",            name: "SKU",                type: "single_line_text_field" },
        { key: "base_price",     name: "Base Price (税込)",   type: "number_integer" },
        { key: "version",        name: "Version",            type: "single_line_text_field" },
        { key: "hardware_config",  name: "Hardware Config",  type: "json" },
        { key: "peripheral_config", name: "Peripheral Config", type: "json" },
        { key: "service_config",   name: "Service Config",   type: "json" },
      ],
    },
  };

  const result = await adminGraphQL(token, query, variables);
  const def = result.data?.metaobjectDefinitionCreate;

  if (def?.userErrors?.length > 0) {
    if (def.userErrors.some(e => e.message.includes('already exists') || e.message.includes('taken'))) {
      console.log('  -> 定義は既に存在します。スキップ。');
      return true;
    }
    console.error('  -> 定義作成エラー:', JSON.stringify(def.userErrors, null, 2));
    return false;
  }

  console.log('  -> 定義作成成功:', def?.metaobjectDefinition?.type);
  return true;
}

// ============================================================
// Metaobject データ投入
// ============================================================

async function upsertBTOProduct(token, btoData) {
  console.log('\n--- BTOデータを投入中... ---');
  console.log(`  Product: ${btoData.product.name}`);
  console.log(`  SKU: ${btoData.product.sku}`);

  const handle = btoData.product.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const query = `
    mutation UpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    handle: {
      type: "bto_product",
      handle: handle,
    },
    metaobject: {
      fields: [
        { key: "product_name",     value: btoData.product.name },
        { key: "sku",              value: btoData.product.sku },
        { key: "base_price",       value: String(btoData.product.base_price_incl_tax) },
        { key: "version",          value: btoData.product.version },
        { key: "hardware_config",  value: JSON.stringify(btoData.hardware_config) },
        { key: "peripheral_config", value: JSON.stringify(btoData.peripheral_config) },
        { key: "service_config",   value: JSON.stringify(btoData.service_config) },
      ],
    },
  };

  const result = await adminGraphQL(token, query, variables);
  const upsert = result.data?.metaobjectUpsert;

  if (upsert?.userErrors?.length > 0) {
    console.error('  -> データ投入エラー:', JSON.stringify(upsert.userErrors, null, 2));
    return false;
  }

  console.log('  -> 投入成功!');
  console.log(`     ID: ${upsert?.metaobject?.id}`);
  console.log(`     Handle: ${upsert?.metaobject?.handle}`);
  return true;
}

// ============================================================
// Component Product 作成・取得
// ============================================================

/**
 * Handle からプロダクトを検索し、存在すれば { id, variantId } を返す
 */
async function getProductByHandle(token, handle) {
  const query = `
    query GetProduct($handle: String!) {
      productByIdentifier(identifier: { handle: $handle }) {
        id
        variants(first: 1) {
          nodes {
            id
          }
        }
      }
    }
  `;
  const result = await adminGraphQL(token, query, { handle });
  const product = result.data?.productByIdentifier;
  if (!product) return null;
  return {
    id: product.id,
    variantId: product.variants.nodes[0]?.id,
  };
}

/**
 * コンポーネント商品を作成し、variantId を返す
 */
async function createComponentProduct(token, { handle, title, priceIncl, tags }) {
  // Step 1: Create product (variants field not on ProductCreateInput in 2025-01+)
  const createQuery = `
    mutation CreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          variants(first: 1) {
            nodes {
              id
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const createResult = await adminGraphQL(token, createQuery, {
    product: { handle, title, status: 'ACTIVE', tags },
  });
  const created = createResult.data?.productCreate;

  if (created?.userErrors?.length > 0) {
    console.error(`    !! 作成エラー [${handle}]:`, JSON.stringify(created.userErrors));
    return null;
  }

  const productId = created?.product?.id;
  const variantId = created?.product?.variants?.nodes?.[0]?.id;
  if (!productId || !variantId) return null;

  // Step 2: Set price and inventory on the auto-created default variant
  const updateQuery = `
    mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updateResult = await adminGraphQL(token, updateQuery, {
    productId,
    variants: [{
      id: variantId,
      price: String(priceIncl),
      inventoryPolicy: 'DENY',
      inventoryItem: { tracked: true },
    }],
  });
  const updated = updateResult.data?.productVariantsBulkUpdate;
  if (updated?.userErrors?.length > 0) {
    console.error(`    !! バリアント更新エラー [${handle}]:`, JSON.stringify(updated.userErrors));
  }

  return { productId, variantId };
}

async function publishProduct(token, productId, publications) {
  if (!publications.length) return;
  const result = await adminGraphQL(token, `
    mutation Publish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { ... on Product { id } }
        userErrors { field message }
      }
    }
  `, { id: productId, input: publications.map(p => ({ publicationId: p.id })) });
  const errors = result.data?.publishablePublish?.userErrors;
  if (errors?.length) console.error(`    !! 公開エラー [${productId}]:`, JSON.stringify(errors));
}

async function setLeadTimeMetafield(token, productId, leadTime) {
  const result = await adminGraphQL(token, `
    mutation SetLeadTime($id: ID!, $metafields: [MetafieldInput!]!) {
      productUpdate(input: { id: $id, metafields: $metafields }) {
        userErrors { field message }
      }
    }
  `, {
    id: productId,
    metafields: [{
      namespace: 'bto',
      key: 'lead_time',
      value: String(leadTime),
      type: 'number_integer',
    }],
  });
  const errors = result.data?.productUpdate?.userErrors;
  if (errors?.length) console.error(`    !! lead_time メタフィールドエラー [${productId}]:`, JSON.stringify(errors));
}

async function ensureComponentProduct(token, { handle, title, priceIncl, leadTime, tags, publications }) {
  const existing = await getProductByHandle(token, handle);
  if (existing?.variantId) {
    // Publish (in case created before publish step was added) + update title + update lead_time
    await publishProduct(token, existing.id, publications);
    await adminGraphQL(token, `
      mutation UpdateProductTitle($id: ID!, $title: String!) {
        productUpdate(product: { id: $id, title: $title }) {
          userErrors { field message }
        }
      }
    `, { id: existing.id, title });
    await setLeadTimeMetafield(token, existing.id, leadTime);
    process.stdout.write(' [更新]');
    return existing.variantId;
  }

  const created = await createComponentProduct(token, { handle, title, priceIncl, tags });
  if (created) {
    await publishProduct(token, created.productId, publications);
    await setLeadTimeMetafield(token, created.productId, leadTime);
    process.stdout.write(' [作成]');
  }
  return created?.variantId ?? null;
}

/**
 * 全コンポーネント商品を作成し、設定JSONに shopify_variant_id を書き込む
 * - single_select / multi_select: オプションごとに1商品
 * - fixed: セクションごとに1商品 (price ¥0)
 */
async function createComponentProducts(token, btoData) {
  console.log('\n--- コンポーネント商品を作成中... ---');

  // Publication IDs for nobu-note-store.myshopify.com
  const publications = [
    { id: 'gid://shopify/Publication/247009149240', name: 'Online Store' },
    { id: 'gid://shopify/Publication/294215582008', name: 'Hydrogen' },
  ];
  console.log(`  公開先: ${publications.map(p => p.name).join(', ')}`);

  const skuBase = btoData.product.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const baseProductHandle = 'g-tune-fz-i9g90'; // 基本商品のhandle

  const configKeys = ['hardware_config', 'peripheral_config', 'service_config'];
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const configKey of configKeys) {
    const config = btoData[configKey];
    if (!config?.sections) continue;

    for (const section of config.sections) {
      if (section.type === 'fixed') {
        // 固定コンポーネント: セクションごとに1商品
        const handle = `bto-${skuBase}-${section.slug}`;
        const title = `[BTO部品] ${section.name}`;
        const tags = [
          'bto-component',
          `bto-base:${baseProductHandle}`,
          `bto-section:${section.slug}`,
          'bto-fixed',
        ];

        process.stdout.write(`  ${section.name} (fixed)`);
        const variantId = await ensureComponentProduct(token, { handle, title, priceIncl: 0, leadTime: section.lead_time ?? 4, tags, publications });
        console.log('');

        if (variantId) {
          section.shopify_variant_id = variantId;
          totalCreated++;
        } else {
          totalSkipped++;
        }

      } else if (section.type === 'single_select' || section.type === 'multi_select') {
        // 選択式: オプションごとに1商品
        for (let i = 0; i < section.options.length; i++) {
          const option = section.options[i];
          const handle = `bto-${skuBase}-${section.slug}-${i}`;
          const title = `[BTO部品] ${section.name}: ${option.name.slice(0, 80)}`;
          const tags = [
            'bto-component',
            `bto-base:${baseProductHandle}`,
            `bto-section:${section.slug}`,
            option.is_default ? 'bto-default' : 'bto-upgrade',
          ];

          process.stdout.write(`  ${section.name} [${i}]`);
          const variantId = await ensureComponentProduct(token, {
            handle,
            title,
            priceIncl: option.price_incl,
            leadTime: option.lead_time ?? 4,
            tags,
            publications,
          });
          console.log('');

          if (variantId) {
            option.shopify_variant_id = variantId;
            totalCreated++;
          } else {
            totalSkipped++;
          }
        }
      }
    }
  }

  console.log(`\n  完了: ${totalCreated} 件処理, ${totalSkipped} 件スキップ`);
  return btoData;
}

// ============================================================
// メイン処理（OAuth + インポート）
// ============================================================

async function runImport(accessToken) {
  const jsonPath = path.join(__dirname, '..', 'bto-configs', 'fz-i9g90.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('BTOデータファイルが見つかりません:', jsonPath);
    return;
  }

  const btoData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log('\n=== BTO on Shopify - インポート ===');
  console.log(`Store: ${STORE_DOMAIN}`);
  console.log(`Product: ${btoData.product.name} (${btoData.product.sku})`);

  // 1. Metaobject定義を作成
  const defOk = await createMetaobjectDefinition(accessToken);
  if (!defOk) {
    console.error('Metaobject定義の作成に失敗しました。');
    return;
  }

  // 1b. bto.lead_time メタフィールド定義を作成（既存の場合はエラーを無視）
  console.log('\n--- bto.lead_time メタフィールド定義を確認中... ---');
  const mfDefResult = await adminGraphQL(accessToken, `
    mutation {
      metafieldDefinitionCreate(definition: {
        name: "リードタイム（日数）"
        namespace: "bto"
        key: "lead_time"
        description: "このBTOコンポーネントの出荷リードタイム（日数）"
        type: "number_integer"
        ownerType: PRODUCT
      }) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }
  `);
  const mfDefErrors = mfDefResult.data?.metafieldDefinitionCreate?.userErrors ?? [];
  const alreadyExists = mfDefErrors.some((e) => e.code === 'TAKEN');
  if (mfDefErrors.length > 0 && !alreadyExists) {
    console.warn('  メタフィールド定義の作成に問題がありました:', JSON.stringify(mfDefErrors));
  } else {
    console.log(alreadyExists ? '  定義は既に存在します（スキップ）' : '  定義を作成しました ✓');
  }

  // 2. コンポーネント商品を作成し、variant IDをJSONに書き込む
  const enrichedBtoData = await createComponentProducts(accessToken, btoData);

  // 3. BTOデータ（variant ID付き）をmetaobjectに投入
  const dataOk = await upsertBTOProduct(accessToken, enrichedBtoData);
  if (!dataOk) {
    console.error('BTOデータの投入に失敗しました。');
    return;
  }

  // 4. 更新済みJSONをローカルファイルにも書き戻す（次回実行時の参照用）
  fs.writeFileSync(jsonPath, JSON.stringify(enrichedBtoData, null, 2), 'utf-8');
  console.log('\nローカルJSONファイルを variant ID付きで更新しました。');

  const hwSize = JSON.stringify(enrichedBtoData.hardware_config).length;
  const peSize = JSON.stringify(enrichedBtoData.peripheral_config).length;
  const svSize = JSON.stringify(enrichedBtoData.service_config).length;
  console.log('\n--- JSON フィールドサイズ ---');
  console.log(`  hardware_config:  ${(hwSize/1024).toFixed(1)} KB (上限 64KB)`);
  console.log(`  peripheral_config: ${(peSize/1024).toFixed(1)} KB (上限 64KB)`);
  console.log(`  service_config:   ${(svSize/1024).toFixed(1)} KB (上限 64KB)`);

  console.log('\nインポート完了!');
  console.log('次のステップ:');
  console.log('  - Shopify管理画面 > 商品 でコンポーネント商品を確認');
  console.log('  - Shopify管理画面 > コンテンツ > Metaobjects でBTOデータを確認');
  console.log('  - http://localhost:3000/bto/fzi9g90g8bfdw104dec でコンフィギュレーターを確認');
}

// ============================================================
// OAuth サーバー
// ============================================================

function startOAuthFlow() {
  const nonce = crypto.randomBytes(16).toString('hex');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/') {
      const shop = STORE_DOMAIN.replace('.myshopify.com', '');
      const authUrl = `https://admin.shopify.com/store/${shop}/oauth/authorize?` +
        `client_id=${CLIENT_ID}` +
        `&scope=${SCOPES}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&state=${nonce}`;

      res.writeHead(302, { Location: authUrl });
      res.end();
      return;
    }

    if (url.pathname === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (state !== nonce) {
        res.writeHead(400);
        res.end('State mismatch. Please try again.');
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('No authorization code received.');
        return;
      }

      console.log('\n認可コード取得。アクセストークンを交換中...');
      const tokenBody = JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
      });

      const tokenRes = await httpsRequest(
        `https://${STORE_DOMAIN}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        tokenBody
      );

      if (!tokenRes.data.access_token) {
        console.error('トークン取得失敗:', tokenRes.data);
        res.writeHead(500);
        res.end('Token exchange failed. Check console.');
        server.close();
        return;
      }

      const accessToken = tokenRes.data.access_token;
      console.log('アクセストークン取得成功!');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>認可成功!</h1><p>ターミナルでインポート処理を確認してください。このタブは閉じてOKです。</p></body></html>');

      try {
        await runImport(accessToken);
      } catch (err) {
        console.error('インポートエラー:', err);
      }

      server.close();
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    const authStartUrl = `http://localhost:${PORT}/`;
    console.log('=== BTO Importer - OAuth認可 ===');
    console.log(`\nブラウザで以下のURLを開いてください:\n`);
    console.log(`  ${authStartUrl}\n`);
    console.log('Shopifyの認可画面でアプリのインストールを許可してください。');
    console.log('注意: write_products スコープが必要です。');

    const { exec } = require('child_process');
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} "${authStartUrl}"`, () => {});
  });
}

// 実行
startOAuthFlow();
