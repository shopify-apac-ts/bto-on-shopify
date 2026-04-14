// ============================================================
// bto.$handle.jsx 完全版（カート追加対応）
// ============================================================
// 既存ファイルをこの内容で丸ごと置き換えてください。
// 変更点:
//   - import: useFetcher, CartForm 追加
//   - action() 追加: カートにBTO構成を追加
//   - loader(): Product Variant ID を取得
//   - BTOConfigurator: カート追加ボタン実装
//   - BTOSummary: サイドバーに選択サマリー追加
//   - PRODUCT_VARIANT_QUERY 追加
// ============================================================

import {useLoaderData} from 'react-router';
import {CartForm, Image} from '@shopify/hydrogen';
import {useState, useMemo, useCallback, useEffect} from 'react';
import '../styles/bto.css';

export async function loader({params, context}) {
  const handle = params.handle;

  const {metaobject} = await context.storefront.query(BTO_QUERY, {
    variables: {
      handle: {type: 'bto_product', handle},
    },
  });

  if (!metaobject) {
    throw new Response('BTO Product not found', {status: 404});
  }

  const fields = {};
  for (const field of metaobject.fields) {
    fields[field.key] = field.value;
  }

  // BTO用 Shopify Product の Variant ID を取得
  const {product} = await context.storefront.query(PRODUCT_VARIANT_QUERY, {
    variables: {handle: 'g-tune-fz-i9g90'},
  });

  const hardwareConfig = JSON.parse(fields.hardware_config);
  const peripheralConfig = JSON.parse(fields.peripheral_config);
  const serviceConfig = JSON.parse(fields.service_config);

  // Collect all component variant IDs to check availability in one query
  const allSections = [
    ...hardwareConfig.sections,
    ...peripheralConfig.sections,
    ...serviceConfig.sections,
  ];
  const variantIds = [];
  for (const section of allSections) {
    if (section.type === 'fixed' && section.shopify_variant_id) {
      variantIds.push(section.shopify_variant_id);
    } else if (section.options) {
      for (const opt of section.options) {
        if (opt.shopify_variant_id) variantIds.push(opt.shopify_variant_id);
      }
    }
  }

  // Fetch availability for all component variants (Storefront API supports up to 250 ids)
  const availabilityMap = {};
  if (variantIds.length > 0) {
    const {nodes} = await context.storefront.query(VARIANTS_AVAILABILITY_QUERY, {
      variables: {ids: variantIds},
    });
    for (const node of nodes) {
      if (node?.id) availabilityMap[node.id] = node.availableForSale;
    }
  }

  // Fetch current cart only to support edit-mode restoration of saved selections
  const cartData = await context.cart.get();
  const allCartLines = cartData?.lines?.nodes ?? [];

  // Find base line for THIS specific product handle to restore its selections
  const existingBase = allCartLines.find(
    (l) =>
      l.attributes?.find((a) => a.key === '_bto_handle')?.value === metaobject.handle &&
      l.attributes?.find((a) => a.key === '_bto_role')?.value === 'base',
  );
  const savedSelectionsJson =
    existingBase?.attributes?.find((a) => a.key === '_bto_selections')?.value ?? null;
  let savedSelections = null;
  if (savedSelectionsJson) {
    try {
      savedSelections = JSON.parse(savedSelectionsJson);
    } catch {
      savedSelections = null;
    }
  }

  return {
    handle: metaobject.handle,
    productName: fields.product_name,
    sku: fields.sku,
    basePrice: parseInt(fields.base_price, 10),
    version: fields.version,
    hardwareConfig,
    peripheralConfig,
    serviceConfig,
    variantId: product?.variants?.nodes?.[0]?.id || null,
    productImage: product?.featuredImage || null,
    availabilityMap,
    savedSelections,
    isEditMode: Boolean(savedSelections),
  };
}


export default function BTOConfigurator() {
  const data = useLoaderData();
  const {handle, productName, basePrice, hardwareConfig, peripheralConfig, serviceConfig, variantId, productImage, availabilityMap, savedSelections, isEditMode} = data;
  const [outOfStockDialog, setOutOfStockDialog] = useState(null);
  const allSections = [
    ...hardwareConfig.sections,
    ...peripheralConfig.sections,
    ...serviceConfig.sections,
  ];

  const initialSelections = {};
  for (const section of allSections) {
    if (section.type === 'single_select') {
      const defaultOpt = section.options.find((o) => o.is_default);
      initialSelections[section.slug] = defaultOpt ? section.options.indexOf(defaultOpt) : 0;
    } else if (section.type === 'multi_select') {
      initialSelections[section.slug] = [];
    }
  }

  const [selections, setSelections] = useState(savedSelections ?? initialSelections);
  const [activeTab, setActiveTab] = useState('hardware');

  // Persist this product's path so CartEmpty can link back here
  useEffect(() => {
    localStorage.setItem('lastBtoPath', `/bto/${handle}`);
  }, [handle]);

  const totalPrice = useMemo(() => {
    let total = basePrice;
    for (const section of allSections) {
      if (section.type === 'single_select') {
        const idx = selections[section.slug];
        if (idx !== undefined && section.options[idx]) {
          total += section.options[idx].price_incl;
        }
      } else if (section.type === 'multi_select') {
        const selected = selections[section.slug] || [];
        for (const idx of selected) {
          if (section.options[idx]) {
            total += section.options[idx].price_incl;
          }
        }
      }
    }
    return total;
  }, [selections, allSections, basePrice]);

  // カートに追加するラインのリストを構築
  // base product + 各コンポーネント商品 (全て同じ _bto_bundle_id を共有)
  const buildCartLines = useCallback(() => {
    const bundleId = crypto.randomUUID();
    // Summarise non-default upgrades for cart display
    const upgrades = [];
    for (const section of allSections) {
      if (section.type === 'single_select') {
        const opt = section.options[selections[section.slug]];
        if (opt && !opt.is_default && opt.price_incl !== 0) {
          upgrades.push(`${section.name}: ${opt.name}`);
        }
      } else if (section.type === 'multi_select') {
        for (const idx of selections[section.slug] || []) {
          const opt = section.options[idx];
          if (opt) upgrades.push(`${section.name}: ${opt.name}`);
        }
      }
    }

    const baseAttrs = [
      {key: '_bto_bundle_id', value: bundleId},
      {key: '_bto_role', value: 'base'},
      {key: '_bto_product', value: productName},
      {key: '_bto_handle', value: handle},
      {key: '_bto_selections', value: JSON.stringify(selections)},
      ...(upgrades.length > 0 ? [{key: '_bto_upgrades', value: upgrades.join(' / ')}] : []),
    ];

    const lines = [{merchandiseId: variantId, quantity: 1, attributes: baseAttrs}];

    for (const section of allSections) {
      if (section.type === 'fixed') {
        if (section.shopify_variant_id) {
          lines.push({
            merchandiseId: section.shopify_variant_id,
            quantity: 1,
            attributes: [
              {key: '_bto_bundle_id', value: bundleId},
              {key: '_bto_role', value: 'component'},
              {key: '_bto_section', value: section.name},
            ],
          });
        }
      } else if (section.type === 'single_select') {
        const opt = section.options[selections[section.slug]];
        if (opt?.shopify_variant_id) {
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
      } else if (section.type === 'multi_select') {
        for (const idx of selections[section.slug] || []) {
          const opt = section.options[idx];
          if (opt?.shopify_variant_id) {
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
      }
    }
    return lines;
  }, [selections, allSections, variantId, productName]);

  // Check if all selected variants are in stock before allowing cart add
  // Only check options the user actively selected (non-default single_select + all multi_select).
  // Fixed sections and default options are excluded — they are always part of the base config.
  const checkInventory = useCallback(() => {
    const outOfStock = [];
    for (const section of allSections) {
      if (section.type === 'single_select') {
        const idx = selections[section.slug];
        const opt = section.options[idx];
        if (opt && !opt.is_default && opt.shopify_variant_id && availabilityMap[opt.shopify_variant_id] === false) {
          outOfStock.push(`${section.name}: ${opt.name}`);
        }
      } else if (section.type === 'multi_select') {
        for (const idx of selections[section.slug] || []) {
          const opt = section.options[idx];
          if (opt?.shopify_variant_id && availabilityMap[opt.shopify_variant_id] === false) {
            outOfStock.push(`${section.name}: ${opt.name}`);
          }
        }
      }
    }
    return outOfStock;
  }, [selections, allSections, availabilityMap]);

  const handleSingleSelect = (slug, optionIndex) => {
    setSelections((prev) => ({...prev, [slug]: optionIndex}));
  };

  const handleMultiSelect = (slug, optionIndex) => {
    setSelections((prev) => {
      const current = prev[slug] || [];
      const next = current.includes(optionIndex)
        ? current.filter((i) => i !== optionIndex)
        : [...current, optionIndex];
      return {...prev, [slug]: next};
    });
  };

  // カスタマイズ件数
  const customCount = useMemo(() => {
    let count = 0;
    for (const section of allSections) {
      if (section.type === 'single_select') {
        const idx = selections[section.slug];
        const opt = section.options[idx];
        if (opt && !opt.is_default) count++;
      } else if (section.type === 'multi_select') {
        count += (selections[section.slug] || []).length;
      }
    }
    return count;
  }, [selections, allSections]);

  const sectionGroups = [
    {label: 'ハードウェア', sections: hardwareConfig.sections},
    {label: '周辺機器', sections: peripheralConfig.sections},
    {label: 'ソフト・サービス', sections: serviceConfig.sections},
  ];

  return (
    <div className="bto-page">
      {/* Two-column header: image + product info */}
      <div className="bto-header">
        {productImage && (
          <div className="bto-header-image">
            <Image data={productImage} sizes="360px" alt={productName} />
          </div>
        )}
        <div className="bto-header-info">
          <h1 className="bto-header-title">{productName}</h1>
          <p className="bto-sku">#{data.sku}</p>
          <div className="bto-header-price">
            <span className="bto-header-price-label">販売価格:</span>
            <span className="bto-header-price-value">&yen;{totalPrice.toLocaleString()}</span>
            <span className="bto-header-price-tax">（税別 &yen;{Math.round(totalPrice / 1.1).toLocaleString()}）</span>
          </div>
        </div>
      </div>

      <div className="bto-layout">
        <div className="bto-main">
          {/* All sections in one scrollable list, grouped with headings */}
          {sectionGroups.map((group) => (
            <div key={group.label} className="bto-section-group">
              <h2 className="bto-section-group-label">{group.label}</h2>
              <div className="bto-categories">
                {group.sections.map((section) => (
                  <BTOCategory
                    key={section.slug}
                    section={section}
                    selectedIndex={selections[section.slug]}
                    onSingleSelect={(idx) => handleSingleSelect(section.slug, idx)}
                    onMultiSelect={(idx) => handleMultiSelect(section.slug, idx)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bto-sidebar">
          <div className="bto-price-box">
            <div className="bto-price-label">お見積り金額（税込）</div>
            <div className="bto-price-total">
              &yen;{totalPrice.toLocaleString()}
            </div>
            <div className="bto-price-base">
              ベース価格: &yen;{basePrice.toLocaleString()}
            </div>
            {totalPrice !== basePrice && (
              <div className="bto-price-diff">
                カスタマイズ ({customCount}件): +&yen;{(totalPrice - basePrice).toLocaleString()}
              </div>
            )}
            {variantId ? (
              <CartForm
                route="/cart"
                action={CartForm.ACTIONS.LinesAdd}
                inputs={{lines: buildCartLines()}}
              >
                {(fetcher) => (
                  <>
                    <button
                      className="bto-cart-button"
                      type="submit"
                      disabled={fetcher.state !== 'idle'}
                      onClick={(e) => {
                        const oos = checkInventory();
                        if (oos.length > 0) {
                          e.preventDefault();
                          setOutOfStockDialog(oos);
                        }
                      }}
                    >
                      {fetcher.state !== 'idle'
                        ? '反映中...'
                        : isEditMode
                        ? 'カートに反映（上書き）'
                        : 'カートに反映'}
                    </button>
                    {isEditMode && (
                      <p className="bto-edit-notice">※ 現在のカスタマイズを上書きします</p>
                    )}
                  </>
                )}
              </CartForm>
            ) : (
              <p className="bto-cart-error">Shopify Product が未作成です</p>
            )}
          </div>
        </div>
      </div>

      {outOfStockDialog && (
        <div className="bto-oos-overlay" onClick={() => setOutOfStockDialog(null)}>
          <div className="bto-oos-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="bto-oos-dialog-header">
              <h3>在庫切れの部品があります</h3>
              <p>以下の部品は現在在庫がないため、カートに追加できません:</p>
            </div>
            <ul>
              {outOfStockDialog.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="bto-oos-dialog-footer">
              <button className="bto-oos-close" onClick={() => setOutOfStockDialog(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BTOCategory({section, selectedIndex, onSingleSelect, onMultiSelect}) {
  const [isOpen, setIsOpen] = useState(false);

  if (section.type === 'fixed') {
    return (
      <div className="bto-category bto-category-fixed">
        <div className="bto-category-header">
          <span className="bto-category-name">{section.name}</span>
          <span className="bto-category-value">{section.fixed_value}</span>
        </div>
      </div>
    );
  }

  let currentLabel = '';
  let currentPrice = 0;
  if (section.type === 'single_select') {
    const opt = section.options[selectedIndex];
    if (opt) {
      currentLabel = opt.name;
      currentPrice = opt.price_incl;
    }
  } else if (section.type === 'multi_select') {
    const count = (selectedIndex || []).length;
    currentLabel = count > 0 ? count + '件選択中' : '未選択';
  }

  return (
    <div className={'bto-category ' + (isOpen ? 'open' : '')}>
      <button
        className="bto-category-header bto-category-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="bto-category-name">{section.name}</span>
        <span className="bto-category-current">
          <span className="bto-current-label">{currentLabel}</span>
          {currentPrice > 0 && (
            <span className="bto-current-price">+&yen;{currentPrice.toLocaleString()}</span>
          )}
        </span>
        <span className={'bto-chevron ' + (isOpen ? 'open' : '')}>&#9660;</span>
      </button>

      {isOpen && (
        <div className="bto-options">
          {section.options.map((option, idx) => {
            const isSelected =
              section.type === 'single_select'
                ? selectedIndex === idx
                : (selectedIndex || []).includes(idx);

            return (
              <label
                key={idx}
                className={'bto-option' + (isSelected ? ' selected' : '') + (option.is_default ? ' default' : '')}
              >
                <input
                  type={section.type === 'single_select' ? 'radio' : 'checkbox'}
                  name={section.slug}
                  checked={isSelected}
                  onChange={() =>
                    section.type === 'single_select'
                      ? onSingleSelect(idx)
                      : onMultiSelect(idx)
                  }
                />
                <span className="bto-option-content">
                  <span className="bto-option-name">
                    {option.name}
                    {option.is_recommended && (
                      <span className="bto-badge-recommended">オススメ</span>
                    )}
                    {option.is_default && (
                      <span className="bto-badge-default">標準</span>
                    )}
                  </span>
                  <span className="bto-option-price">
                    {option.price_incl === 0
                      ? ''
                      : option.price_incl > 0
                        ? '+\u00a5' + option.price_incl.toLocaleString()
                        : '-\u00a5' + Math.abs(option.price_incl).toLocaleString()}
                    {option.price_incl !== 0 && (
                      <span className="bto-option-price-excl">
                        (税別 &yen;{option.price_excl.toLocaleString()})
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

const BTO_QUERY = `#graphql
  query BTOProduct($handle: MetaobjectHandleInput!) {
    metaobject(handle: $handle) {
      handle
      type
      fields {
        key
        value
      }
    }
  }
`;

const PRODUCT_VARIANT_QUERY = `#graphql
  query BTOProductVariant($handle: String!) {
    product(handle: $handle) {
      id
      featuredImage {
        url
        altText
        width
        height
      }
      variants(first: 1) {
        nodes {
          id
        }
      }
    }
  }
`;

const VARIANTS_AVAILABILITY_QUERY = `#graphql
  query VariantsAvailability($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        availableForSale
      }
    }
  }
`;